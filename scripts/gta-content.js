(() => {
  if (window.__gtaContentInitialized) return;
  window.__gtaContentInitialized = true;

  const extensionApi = typeof chrome !== "undefined"
    ? chrome
    : (typeof browser !== "undefined" ? browser : null);
  const media = {
    submissionAccepted: {
      video: "assets/mission_passed_green.mp4",
      audio: "assets/mission_passed.mp3",
      label: "MISSION PASSED",
      color: "#4caf50",
    },
    submissionRejected: {
      video: "assets/wasted_green.mp4",
      audio: "assets/wasted.mp3",
      label: "WASTED",
      color: "#f44336",
    },
  };
  const resultSelectors = [
    'span[data-e2e-locator="submission-result"]',
    'div[data-e2e-locator="submission-result"]',
    ".result-status",
    ".resultState",
  ];
  const pendingPatterns = ["pending", "running", "judging", "testing"];
  const failurePatterns = [
    "wrong answer", "time limit exceeded", "runtime error", "compile error",
    "memory limit exceeded", "output limit exceeded", "internal error", "rejected",
  ];
  const completedSubmissionIds = new Set();
  const bannerQueue = [];
  const bridgeToken = crypto.randomUUID();
  let latestSubmission = null;
  let resultBaseline = new Map();
  let observedTerminalKey = null;
  let bannerPlaying = false;

  function injectMainWorldFetchInterceptor() {
    const script = document.createElement("script");
    script.textContent = `(() => {
      if (window.__gtaFetchInterceptorInstalled) return;
      window.__gtaFetchInterceptorInstalled = true;
      const shouldInspect = (url, method) =>
        String(method || "GET").toUpperCase() === "POST"
        && (String(url || "").includes("/graphql") || String(url || "").includes("/submit"));
      const publishSubmissionId = (data) => {
        const submissionId = data?.data?.submissionCreateSubmit?.submissionId
          || data?.data?.submissionCreate?.submissionId
          || data?.data?.submitCode?.submission_id
          || data?.data?.submitCode?.submissionId
          || data?.data?.submit?.submissionId
          || data?.submission_id
          || data?.submissionId;
        if (!submissionId) return;
        window.postMessage({
          type: "GTA_SUBMISSION_ID",
          token: ${JSON.stringify(bridgeToken)},
          submissionId: String(submissionId),
        }, "*");
      };

      const originalFetch = window.fetch;
      window.fetch = function (...args) {
        const responsePromise = originalFetch.apply(this, args);
        responsePromise.then((response) => {
          const request = args[0];
          const options = args[1] || {};
          const url = typeof request === "string" ? request : (request && request.url) || "";
          const method = options.method || (request && request.method) || "GET";
          if (!shouldInspect(url, method)) return;
          response.clone().json().then(publishSubmissionId).catch(() => {});
        }).catch(() => {});
        return responsePromise;
      };

      const originalOpen = XMLHttpRequest.prototype.open;
      const originalSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__gtaRequestMethod = method;
        this.__gtaRequestUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };
      XMLHttpRequest.prototype.send = function (...args) {
        if (shouldInspect(this.__gtaRequestUrl, this.__gtaRequestMethod)) {
          this.addEventListener("load", () => {
            try { publishSubmissionId(JSON.parse(this.responseText)); } catch (_) {}
          }, { once: true });
        }
        return originalSend.apply(this, args);
      };
    })();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();
  }

  function normalizeSubmissionId(value) {
    const submissionId = String(value ?? "");
    return /^\d+$/.test(submissionId) ? submissionId : null;
  }

  function classifyObservedStatus(text) {
    const normalized = String(text || "").trim().toLowerCase();
    if (!normalized) return null;
    if (pendingPatterns.some((pattern) => normalized.includes(pattern))) return "pending";
    if (normalized === "accepted") return "submissionAccepted";
    if (failurePatterns.some((pattern) => normalized.includes(pattern))) {
      return "submissionRejected";
    }
    return null;
  }

  function getResultCandidates() {
    const candidates = [];
    const seen = new Set();
    for (const selector of resultSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) continue;
        seen.add(element);
        candidates.push({
          element,
          text: element.textContent?.trim().toLowerCase() || "",
        });
      }
    }
    return candidates;
  }

  function resetResultBaseline() {
    resultBaseline = new Map(
      getResultCandidates().map(({ element, text }) => [element, text])
    );
    observedTerminalKey = null;
  }

  function sendRuntimeMessage(message) {
    if (!extensionApi?.runtime?.sendMessage) return;
    try {
      const result = extensionApi.runtime.sendMessage(message);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch (_) {
      // Background webRequest detection remains authoritative.
    }
  }

  function observeSubmissionResult() {
    if (!latestSubmission) return;
    for (const { element, text } of getResultCandidates()) {
      const initialText = resultBaseline.get(element);
      const changed = initialText === undefined || initialText !== text;
      if (!changed) continue;
      const status = classifyObservedStatus(text);
      if (!status || status === "pending") continue;
      const terminalKey = `${latestSubmission.id}:${status}:${text}`;
      if (terminalKey === observedTerminalKey) return;
      observedTerminalKey = terminalKey;
      sendRuntimeMessage({
        type: "gtaDomStatusObserved",
        submissionId: latestSubmission.id,
        observedAction: status,
      });
      return;
    }
  }

  function createProxyRequest(message) {
    const url = new URL(String(message?.url || ""));
    if (url.protocol !== "https:" || url.hostname !== "leetcode.com") {
      throw new Error("Only HTTPS requests to leetcode.com are allowed.");
    }
    const method = String(message?.options?.method || "GET").toUpperCase();
    const isProblemsRequest = url.pathname === "/api/problems/all/" && method === "GET";
    const isGraphqlRequest = (url.pathname === "/graphql" || url.pathname === "/graphql/")
      && method === "POST";
    if (!isProblemsRequest && !isGraphqlRequest) {
      throw new Error("This LeetCode endpoint or method is not allowed.");
    }
    const options = { method, credentials: "include" };
    if (isGraphqlRequest) {
      if (typeof message.options?.body !== "string") {
        throw new Error("GraphQL requests require a serialized body.");
      }
      options.headers = { "Content-Type": "application/json" };
      options.body = message.options.body;
    }
    return { url: url.href, options };
  }

  function rememberCompletion(submissionId) {
    completedSubmissionIds.add(submissionId);
  }

  function enqueueVerifiedBanner(action, submissionId) {
    if (!media[action] || !submissionId || completedSubmissionIds.has(submissionId)) {
      return false;
    }
    rememberCompletion(submissionId);
    bannerQueue.push({ action, submissionId });
    processBannerQueue();
    return true;
  }

  function setupSubmissionObserver() {
    window.addEventListener("message", (event) => {
      if (event.source !== window || event.data?.type !== "GTA_SUBMISSION_ID"
          || event.data?.token !== bridgeToken) return;
      const submissionId = normalizeSubmissionId(event.data.submissionId);
      if (!submissionId) return;
      latestSubmission = { id: submissionId, capturedAt: Date.now() };
      resetResultBaseline();
      sendRuntimeMessage({ type: "gtaSubmissionCaptured", submissionId });
    });

    const observer = new MutationObserver((mutations) => {
      if (!latestSubmission) return;
      const isOnlyBannerMutation = mutations.every((mutation) => {
        const target = mutation.target;
        const targetElement = target instanceof Element ? target : target.parentElement;
        if (targetElement?.closest("#gta-banner-container")) return true;
        if (!mutation.addedNodes.length) return false;
        return Array.from(mutation.addedNodes).every((node) => {
          if (!(node instanceof Element)) return false;
          return node.id === "gta-banner-container"
            || Boolean(node.closest("#gta-banner-container"));
        });
      });
      if (!isOnlyBannerMutation) observeSubmissionResult();
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  if (extensionApi?.runtime?.onMessage) {
    extensionApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (sender?.id && sender.id !== extensionApi.runtime.id) return false;
      if (message?.action === "getSubmissionId") {
        const requestedAfter = Number(message.after || 0);
        const isFresh = latestSubmission
          && latestSubmission.capturedAt >= requestedAfter - 250;
        sendResponse({ submissionId: isFresh ? latestSubmission.id : null });
        return false;
      }
      if (message?.action === "proxyFetch" || message?.type === "PROXY_LEETCODE_FETCH") {
        let request;
        try {
          request = createProxyRequest(message);
        } catch (error) {
          sendResponse({ success: false, error: error.message });
          return false;
        }
        fetch(request.url, request.options)
          .then(async (response) => {
            const text = await response.text();
            let data = text;
            try { data = JSON.parse(text); } catch (_) { /* Keep text response. */ }
            sendResponse({
              success: true,
              ok: response.ok,
              status: response.status,
              data,
            });
          })
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
      }
      if (message?.verifiedFinal === true
          && message?.source === "gta-background"
          && media[message?.action]) {
        const submissionId = normalizeSubmissionId(message.submissionId);
        const queued = enqueueVerifiedBanner(message.action, submissionId);
        sendResponse({ received: true, queued, action: message.action });
      }
      return false;
    });
  }

  async function processBannerQueue() {
    if (bannerPlaying) return;
    bannerPlaying = true;
    try {
      while (bannerQueue.length) {
        const next = bannerQueue.shift();
        await showBanner(next.action);
      }
    } finally {
      bannerPlaying = false;
    }
  }

  function animate(container, keyframes, options) {
    if (typeof container.animate === "function") return container.animate(keyframes, options);
    container.style.opacity = String(keyframes[keyframes.length - 1].opacity);
    return null;
  }

  function showFallbackBanner(action, container) {
    container.replaceChildren();
    const fallback = document.createElement("div");
    Object.assign(fallback.style, {
      width: "100%", height: "100%", display: "flex", alignItems: "center",
      justifyContent: "center", fontFamily: "Arial Black, Impact, sans-serif",
      fontSize: "2.5em", fontWeight: "bold", letterSpacing: "3px",
      background: "linear-gradient(135deg, rgba(0,0,0,.8), rgba(0,0,0,.55))",
      color: media[action].color, textShadow: `0 0 24px ${media[action].color}`,
      border: `2px solid ${media[action].color}`,
    });
    fallback.textContent = media[action].label;
    container.appendChild(fallback);
  }

  function showBanner(action) {
    return new Promise((resolve) => {
      if (!media[action] || !extensionApi?.runtime?.getURL || !document.body) {
        resolve();
        return;
      }

      const container = document.createElement("div");
      container.id = "gta-banner-container";
      Object.assign(container.style, {
        position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        zIndex: "999999", width: "100%", height: "300px", opacity: "0",
        pointerEvents: "none", overflow: "hidden", borderRadius: "15px",
        boxShadow: "0 0 30px rgba(0,0,0,.6)", backgroundColor: "rgba(0,0,0,.3)",
      });

      const video = document.createElement("video");
      const audio = new Audio(extensionApi.runtime.getURL(media[action].audio));
      let videoFinished = false;
      let audioFinished = false;
      let removing = false;
      let cleanupTimer = null;

      const removeBanner = () => {
        if (removing) return;
        removing = true;
        clearTimeout(cleanupTimer);
        animate(container, [
          { opacity: 1, transform: "translate(-50%, -50%) scale(1)" },
          { opacity: 0, transform: "translate(-50%, -50%) scale(0.9)" },
        ], { duration: 500, easing: "ease", fill: "forwards" });
        setTimeout(() => {
          audio.pause();
          container.remove();
          resolve();
        }, 500);
      };
      const finishWhenReady = () => {
        if (videoFinished && audioFinished) removeBanner();
      };
      const finishVideo = (fallback = false) => {
        if (videoFinished) return;
        videoFinished = true;
        if (fallback && container.isConnected) showFallbackBanner(action, container);
        finishWhenReady();
      };
      const finishAudio = () => {
        if (audioFinished) return;
        audioFinished = true;
        finishWhenReady();
      };

      video.src = extensionApi.runtime.getURL(media[action].video);
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      Object.assign(video.style, { width: "100%", height: "100%", objectFit: "cover" });
      video.addEventListener("error", () => finishVideo(true), { once: true });
      video.addEventListener("ended", () => finishVideo(false), { once: true });
      audio.addEventListener("error", finishAudio, { once: true });
      audio.addEventListener("ended", finishAudio, { once: true });
      audio.volume = 0.8;

      container.appendChild(video);
      document.body.appendChild(container);
      animate(container, [
        { opacity: 0, transform: "translate(-50%, -50%) scale(0.9)" },
        { opacity: 1, transform: "translate(-50%, -50%) scale(1)" },
      ], { duration: 600, easing: "cubic-bezier(.25,1,.5,1)", fill: "forwards" });

      video.play().catch(() => finishVideo(true));
      audio.play().catch(finishAudio);
      cleanupTimer = setTimeout(removeBanner, 30000);
    });
  }

  function initialize() {
    injectMainWorldFetchInterceptor();
    setupSubmissionObserver();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
