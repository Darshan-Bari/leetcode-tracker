const extensionApi = typeof chrome !== "undefined"
  ? chrome
  : (typeof browser !== "undefined" ? browser : null);

const attemptsByTab = new Map();
const completedSubmissionIds = new Map();
const submitOperationNames = [
  "submitCode", "submissionCreateSubmit", "submissionCreate", "submitSolution",
  "consolePanelSubmit", "submit", "questionSubmit", "submitProblem",
  "submitCodeMutation", "problemsetQuestionSubmit", "submitQuestion",
];
const pendingPatterns = ["pending", "running", "judging", "testing", "started"];
const failurePatterns = [
  "wrong answer", "time limit exceeded", "runtime error", "compile error",
  "memory limit exceeded", "output limit exceeded", "internal error", "rejected",
];
let nextAttemptId = 1;

function getLastError() {
  return extensionApi?.runtime?.lastError;
}

function callApi(method, context, ...args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(value);
    };
    try {
      const callback = (value) => {
        const error = getLastError();
        finish(value, error ? new Error(error.message) : null);
      };
      const result = method.call(context, ...args, callback);
      if (result && typeof result.then === "function") {
        result.then((value) => finish(value, null), (error) => finish(undefined, error));
      }
    } catch (error) {
      finish(undefined, error);
    }
  });
}

function getAttempts(tabId, create = false) {
  if (!attemptsByTab.has(tabId) && create) attemptsByTab.set(tabId, []);
  return attemptsByTab.get(tabId) || [];
}

function clearAttemptTimer(attempt) {
  if (attempt?.timer) clearTimeout(attempt.timer);
  if (attempt) attempt.timer = null;
}

function createAttempt(tabId) {
  const attempts = getAttempts(tabId, true);
  const attempt = {
    attemptId: nextAttemptId++,
    tabId,
    createdAt: Date.now(),
    submissionId: null,
    retryCount: 0,
    finalized: false,
    timer: null,
    idRequestStarted: false,
  };
  attempts.push(attempt);
  return attempt;
}

function removeAttempt(attempt) {
  clearAttemptTimer(attempt);
  const attempts = getAttempts(attempt.tabId);
  const index = attempts.indexOf(attempt);
  if (index >= 0) attempts.splice(index, 1);
  if (!attempts.length) attemptsByTab.delete(attempt.tabId);
}

function findAttemptById(tabId, submissionId) {
  return getAttempts(tabId).find((attempt) =>
    !attempt.finalized && attempt.submissionId === String(submissionId)
  ) || null;
}

function bindSubmissionId(tabId, submissionId) {
  const normalizedId = String(submissionId);
  if (!/^\d+$/.test(normalizedId) || completedSubmissionIds.has(normalizedId)) return null;
  const existing = findAttemptById(tabId, normalizedId);
  if (existing) return existing;
  const attempt = getAttempts(tabId)
    .filter((candidate) => !candidate.finalized && !candidate.submissionId)
    .sort((left, right) => left.createdAt - right.createdAt)[0];
  if (!attempt) return null;
  attempt.submissionId = normalizedId;
  attempt.retryCount = 0;
  return attempt;
}

function readRequestBody(details) {
  if (details.method !== "POST") return null;
  if (details.requestBody?.formData) return details.requestBody.formData;
  const bytes = details.requestBody?.raw?.[0]?.bytes;
  if (!bytes) return null;
  const text = new TextDecoder("utf-8").decode(bytes);
  try { return JSON.parse(text); } catch (_) { return text; }
}

function bodyContainsSubmitOperation(body) {
  if (!body) return false;
  if (typeof body === "string") {
    const lower = body.toLowerCase();
    return submitOperationNames.some((name) => lower.includes(name.toLowerCase()))
      || /mutation[\s\S]*submit/i.test(body);
  }
  if (Array.isArray(body)) return body.some(bodyContainsSubmitOperation);
  if (typeof body !== "object") return false;
  const operationName = String(body.operationName || "").toLowerCase();
  if (operationName.includes("submit")) return true;
  if (body.query && bodyContainsSubmitOperation(String(body.query))) return true;
  return Object.values(body).some(bodyContainsSubmitOperation);
}

function isSubmissionRequest(details) {
  if (details.tabId < 0 || details.method !== "POST") return false;
  let url;
  try { url = new URL(details.url); } catch (_) { return false; }
  if (url.hostname !== "leetcode.com" && !url.hostname.endsWith(".leetcode.com")) return false;
  if (/\/problems\/[^/]+\/submit\/?$/i.test(url.pathname)) return true;
  if (url.pathname.includes("/submit") && !url.pathname.includes("/check")) return true;
  return url.pathname.includes("/graphql") && bodyContainsSubmitOperation(readRequestBody(details));
}

function extractSubmissionId(url) {
  return url.match(/\/submissions\/detail\/(\d+)\/check\/?/)?.[1] || null;
}

async function getAuthHeaders() {
  const headers = {
    "Content-Type": "application/json",
    "Referer": "https://leetcode.com",
  };
  if (!extensionApi?.cookies?.getAll) return headers;
  try {
    const cookies = await callApi(
      extensionApi.cookies.getAll,
      extensionApi.cookies,
      { domain: "leetcode.com" }
    );
    if (cookies?.length) {
      headers.Cookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
      const csrfCookie = cookies.find((cookie) => cookie.name === "csrftoken");
      if (csrfCookie) headers["x-csrftoken"] = csrfCookie.value;
    }
  } catch (error) {
    console.warn("GTA: Could not read LeetCode cookies", error);
  }
  return headers;
}

function statusAction(statusCode, statusDisplay, state) {
  const code = Number(statusCode || 0);
  const display = String(statusDisplay || "").trim().toLowerCase();
  const normalizedState = String(state || "").trim().toLowerCase();
  if (pendingPatterns.some((pattern) =>
    display.includes(pattern) || normalizedState.includes(pattern))) {
    return null;
  }
  if (code === 10 || display === "accepted") return "submissionAccepted";
  if (code > 10 || failurePatterns.some((pattern) => display.includes(pattern))) {
    return "submissionRejected";
  }
  return null;
}

async function fetchAcceptedSubmissionDetails(submissionId) {
  const query = `query submissionDetails($submissionId: Int!) {
    submissionDetails(submissionId: $submissionId) {
      code statusCode lang { name } question { questionId titleSlug }
    }
  }`;
  try {
    const response = await fetch("https://leetcode.com/graphql/", {
      method: "POST",
      credentials: "include",
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        query,
        operationName: "submissionDetails",
        variables: { submissionId: Number(submissionId) },
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const details = payload?.data?.submissionDetails;
    if (Number(details?.statusCode) !== 10 || !details?.code) return null;
    return {
      code: details.code,
      language: details.lang?.name || "",
      questionId: details.question?.questionId || "",
      titleSlug: details.question?.titleSlug || "",
    };
  } catch (error) {
    console.warn("GTA: Could not load accepted submission details", error);
    return null;
  }
}

async function sendTabMessage(tabId, message) {
  if (!extensionApi?.tabs?.sendMessage) return false;
  for (let retry = 0; retry < 3; retry += 1) {
    try {
      await callApi(extensionApi.tabs.sendMessage, extensionApi.tabs, tabId, message);
      return true;
    } catch (error) {
      if (retry === 2) {
        console.warn(`GTA: Unable to deliver ${message.action} to tab ${tabId}`, error);
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * (retry + 1)));
    }
  }
  return false;
}

async function finalizeAttempt(attempt, action) {
  if (!attempt || attempt.finalized || !attempt.submissionId) return;
  if (completedSubmissionIds.has(attempt.submissionId)) {
    removeAttempt(attempt);
    return;
  }

  attempt.finalized = true;
  clearAttemptTimer(attempt);
  completedSubmissionIds.set(attempt.submissionId, Date.now());
  await sendTabMessage(attempt.tabId, {
    action,
    submissionId: attempt.submissionId,
    verifiedFinal: true,
    source: "gta-background",
  });
  removeAttempt(attempt);

  if (action === "submissionAccepted") {
    const submission = await fetchAcceptedSubmissionDetails(attempt.submissionId);
    await sendTabMessage(attempt.tabId, {
      action: "syncAcceptedSubmission",
      submissionId: attempt.submissionId,
      submission,
      source: "gta-background",
    });
  }
}

function schedulePoll(attempt, useGraphQL = false, delay = 700) {
  if (!attempt || attempt.finalized || !attempt.submissionId) return;
  clearAttemptTimer(attempt);
  attempt.timer = setTimeout(() => {
    if (useGraphQL) pollSubmissionGraphQL(attempt);
    else pollSubmissionCheck(attempt);
  }, delay);
}

function retryPoll(attempt, useGraphQL) {
  if (!attempt || attempt.finalized) return;
  attempt.retryCount += 1;
  if (attempt.retryCount >= 90 || Date.now() - attempt.createdAt > 10 * 60 * 1000) {
    removeAttempt(attempt);
    return;
  }
  schedulePoll(
    attempt,
    useGraphQL,
    Math.min(750 + attempt.retryCount * 250, 4000)
  );
}

async function pollSubmissionCheck(attempt) {
  if (!attempt || attempt.finalized || !attempt.submissionId) return;
  try {
    const response = await fetch(
      `https://leetcode.com/submissions/detail/${attempt.submissionId}/check/`,
      { method: "GET", credentials: "include", headers: await getAuthHeaders() }
    );
    if (response.status === 401 || response.status === 403) {
      schedulePoll(attempt, true, 0);
      return;
    }
    if (!response.ok) {
      retryPoll(attempt, false);
      return;
    }
    const data = await response.json();
    const action = statusAction(data.status_code, data.status_display, data.state);
    if (action) await finalizeAttempt(attempt, action);
    else retryPoll(attempt, false);
  } catch (error) {
    console.warn("GTA: Submission check failed", error);
    retryPoll(attempt, false);
  }
}

async function pollSubmissionGraphQL(attempt) {
  if (!attempt || attempt.finalized || !attempt.submissionId) return;
  const query = `query submissionDetails($submissionId: Int!) {
    submissionDetails(submissionId: $submissionId) {
      statusCode runtimeError compileError lastTestcase totalCorrect totalTestcases
    }
  }`;
  try {
    const response = await fetch("https://leetcode.com/graphql/", {
      method: "POST",
      credentials: "include",
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        query,
        operationName: "submissionDetails",
        variables: { submissionId: Number(attempt.submissionId) },
      }),
    });
    if (!response.ok) {
      retryPoll(attempt, true);
      return;
    }
    const data = await response.json();
    const details = data?.data?.submissionDetails;
    const action = statusAction(
      details?.statusCode,
      details?.statusDisplay,
      details?.state
    );
    if (action) await finalizeAttempt(attempt, action);
    else retryPoll(attempt, true);
  } catch (error) {
    console.warn("GTA: GraphQL submission check failed", error);
    retryPoll(attempt, true);
  }
}

async function requestSubmissionId(attempt, retryCount = 0) {
  if (!attempt || attempt.finalized || attempt.submissionId) return;
  try {
    const response = await callApi(
      extensionApi.tabs.sendMessage,
      extensionApi.tabs,
      attempt.tabId,
      { action: "getSubmissionId", after: attempt.createdAt }
    );
    const submissionId = String(response?.submissionId || "");
    if (/^\d+$/.test(submissionId) && !completedSubmissionIds.has(submissionId)) {
      const existing = findAttemptById(attempt.tabId, submissionId);
      if (!existing || existing === attempt) {
        attempt.submissionId = submissionId;
        attempt.retryCount = 0;
        schedulePoll(attempt, false, 0);
        return;
      }
    }
  } catch (_) {
    // The page bridge or content script may still be loading.
  }
  if (retryCount < 16 && !attempt.finalized && !attempt.submissionId) {
    attempt.timer = setTimeout(
      () => requestSubmissionId(attempt, retryCount + 1),
      750
    );
  }
}

if (extensionApi?.runtime?.onMessage) {
  extensionApi.runtime.onMessage.addListener((message, sender) => {
    const tabId = sender?.tab?.id;
    if (!Number.isInteger(tabId)) return;

    if (message?.type === "gtaSubmissionCaptured") {
      const submissionId = String(message.submissionId || "");
      const attempt = bindSubmissionId(tabId, submissionId);
      if (attempt) schedulePoll(attempt, false, 150);
      return;
    }

    if (message?.type === "gtaDomStatusObserved") {
      const submissionId = String(message.submissionId || "");
      const attempt = findAttemptById(tabId, submissionId);
      if (attempt) {
        attempt.retryCount = 0;
        schedulePoll(attempt, false, 0);
      }
    }
  });
}

if (extensionApi?.webRequest?.onBeforeRequest) {
  extensionApi.webRequest.onBeforeRequest.addListener((details) => {
    if (isSubmissionRequest(details)) {
      const attempt = createAttempt(details.tabId);
      attempt.requestId = details.requestId || null;
    }
  }, { urls: ["*://leetcode.com/*", "*://*.leetcode.com/*"] }, ["requestBody"]);
}

if (extensionApi?.webRequest?.onCompleted) {
  extensionApi.webRequest.onCompleted.addListener((details) => {
    const submissionId = extractSubmissionId(details.url);
    if (submissionId) {
      const attempt = findAttemptById(details.tabId, submissionId)
        || bindSubmissionId(details.tabId, submissionId);
      if (attempt) schedulePoll(attempt, false, 100);
      return;
    }

    if (!details.url.includes("/graphql")) return;
    const attempts = getAttempts(details.tabId)
      .filter((attempt) => !attempt.finalized && !attempt.submissionId)
      .sort((left, right) => right.createdAt - left.createdAt);
    const requestAttempt = attempts.find((attempt) =>
      attempt.requestId && attempt.requestId === details.requestId
    ) || attempts[0];
    if (requestAttempt && !requestAttempt.idRequestStarted) {
      requestAttempt.idRequestStarted = true;
      requestAttempt.timer = setTimeout(
        () => requestSubmissionId(requestAttempt),
        400
      );
    }
  }, { urls: ["*://leetcode.com/*", "*://*.leetcode.com/*"] });
}

if (extensionApi?.tabs?.onRemoved) {
  extensionApi.tabs.onRemoved.addListener((tabId) => {
    for (const attempt of getAttempts(tabId)) clearAttemptTimer(attempt);
    attemptsByTab.delete(tabId);
  });
}

setInterval(() => {
  const now = Date.now();
  for (const attempts of attemptsByTab.values()) {
    for (const attempt of [...attempts]) {
      if (now - attempt.createdAt > 10 * 60 * 1000) removeAttempt(attempt);
    }
  }
}, 30000);
