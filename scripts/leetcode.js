  import Problem from "./models/problem.js";
  import RouteService from "./services/route-service.js";
  import GithubService from "./services/github-service.js";

  const extensionApi = typeof chrome !== "undefined"
    ? chrome
    : (typeof browser !== "undefined" ? browser : null);

  /**
   * Main controller class for the LeetCode Tracker extension.
   * Orchestrates the interaction between LeetCode's interface and GitHub synchronization.
   */
  export default class LeetcodeTracker {
    /**
     * Initialize the LeetCode Tracker with required services and route monitoring.
     * Sets up problem model, GitHub service, and route change detection.
     */
    constructor() {
      this.problem = new Problem();
      this.githubService = new GithubService();
      this.inFlightSubmissions = new Set();
      this.processedSubmissionIds = new Set();
      this.runtimeMessageHandler = (message) => {
        if (message?.action !== "syncAcceptedSubmission"
            || message?.source !== "gta-background") return false;
        this.handleSubmission(message).catch((error) => {
          console.error("LeetCode Tracker submission handler failed", error);
        });
        return false;
      };
      extensionApi?.runtime?.onMessage?.addListener(this.runtimeMessageHandler);
      this.route = new RouteService(() => this.init());
      this.init();
    }

    /**
     * Initialize or reinitialize metadata for the current problem route.
     */
    init() {
      this.problem = new Problem();
      this.problem.loadProblemFromDOM();
    }

    /**
     * Upload an authoritative accepted submission delivered by the background
     * submission monitor. Submission details are preferred over editor DOM
     * scraping so LeetCode UI changes do not silently prevent synchronization.
     */
    async handleSubmission(message = {}) {
      const submissionId = /^\d+$/.test(String(message.submissionId || ""))
        ? String(message.submissionId)
        : null;
      const submissionKey = submissionId || `route:${window.location.pathname}`;
      if (this.processedSubmissionIds.has(submissionKey)
          || this.inFlightSubmissions.has(submissionKey)) {
        return;
      }
      this.inFlightSubmissions.add(submissionKey);

      const problem = new Problem();
      problem.loadProblemFromDOM();

      try {
        if (message.submission) {
          problem.applySubmissionDetails(message.submission);
        }

        if (!problem.slug) {
          const titleElement = document.querySelector(
            '[data-cy="question-title"], [data-e2e-locator="question-title"], a[href^="/problems/"]'
          );
          const formattedTitle = problem.formatProblemName(
            titleElement?.textContent || ""
          );
          const titleSlug = window.location.pathname.match(/\/problems\/([^/]+)/)?.[1] || "";
          const fallbackTitle = titleSlug
            .split("-")
            .filter(Boolean)
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join("");
          problem.slug = formattedTitle || fallbackTitle;
        }
        if (!problem.language?.extension) problem.extractLanguageFromDOM();
        if (!problem.code?.trim()) problem.extractCodeFromDOM();
        problem.validateForSubmission();

        let isCommentEnabled = false;
        try {
          const result = await extensionApi.storage.local.get(
            "leetcode_tracker_comment_submission"
          );
          isCommentEnabled = !!result?.leetcode_tracker_comment_submission;
        } catch (_) {
          // Continue without a comment when storage is temporarily unavailable.
        }

        const userComment = isCommentEnabled ? await this.showCommentPopup() : "";
        const outcome = await this.githubService.submitToGitHub(problem, userComment);
        this.processedSubmissionIds.add(submissionKey);
        if (outcome?.committed) {
          this.showToast(`Problem ${problem.slug} synced successfully`, "success");
        } else {
          this.showToast(`Problem ${problem.slug} is already synchronized`, "success");
        }
      } catch (error) {
        const messageText = error?.message
          ? error.message.split("\n")[0].slice(0, 160)
          : "Unknown error";
        this.showToast(
          `Problem ${problem.slug || ""} sync failed: ${messageText}`,
          "error"
        );
      } finally {
        this.inFlightSubmissions.delete(submissionKey);
      }
    }

    /**
     * Display a transient toast notification on the LeetCode page.
     * Creates container & styles once, then appends individual toasts.
     *
     * @param {string} message - Text to display.
     * @param {('success'|'error')} type - Visual style variant.
     */
    showToast(message, type = "success") {
      if (!document.getElementById("leetcode-tracker-toast-styles")) {
        const style = document.createElement("style");
        style.id = "leetcode-tracker-toast-styles";
        style.textContent = `
          :root { --ltc-orange: #FFA116; --ltc-success: #00B8A3; --ltc-error: #FF4D4F; }
          #leetcode-tracker-toast-container { position: fixed; bottom: 24px; right: 24px; z-index: 99999; display: flex; flex-direction: column; gap: 14px; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
    .lt-toast { min-width: 280px; max-width: 380px; padding: 14px 18px 14px 16px; border-radius: 18px; display: flex; align-items: flex-start; gap: 12px; font-size: 13px; line-height: 1.45; font-weight: 500; opacity: 0; transform: translateY(10px) scale(.97); animation: lt-toast-in .38s cubic-bezier(.4,.14,.3,1) forwards, lt-toast-out .4s ease forwards 5.2s; position: relative; box-shadow: 0 4px 16px -2px rgba(0,0,0,0.25),0 2px 4px rgba(0,0,0,.12); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border: 1px solid var(--lt-border-color); background: var(--lt-bg); color: var(--lt-fg); }
          .lt-theme-light .lt-toast { --lt-bg: #ffffff; --lt-fg: #262626; --lt-border-color: #e2e2e2; }
          .lt-theme-dark .lt-toast { --lt-bg: #2b2b2b; --lt-fg: #f5f5f5; --lt-border-color: #3a3a3a; }
    /* Static accent ring instead of moving bar */
    .lt-toast-success { box-shadow: 0 0 0 3px rgba(0,184,163,0.15),0 4px 16px -2px rgba(0,0,0,0.25),0 2px 4px rgba(0,0,0,.12); }
    .lt-toast-error { box-shadow: 0 0 0 3px rgba(255,77,79,0.18),0 4px 16px -2px rgba(0,0,0,0.25),0 2px 4px rgba(0,0,0,.12); }
          .lt-toast-icon { width:20px; height:20px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; margin-top:1px; }
          .lt-toast-icon svg { width:20px; height:20px; }
          .lt-toast-success .lt-toast-icon svg { stroke: var(--ltc-success); }
          .lt-toast-error .lt-toast-icon svg { stroke: var(--ltc-error); }
          .lt-toast-close { cursor: pointer; margin-left: 4px; background: transparent; border: none; color: var(--lt-fg); opacity: .55; font-size: 16px; line-height: 1; padding: 0 4px; transition: opacity .15s ease; }
          .lt-toast-close:hover { opacity: .95; }
          @keyframes lt-toast-in { to { opacity: 1; transform: translateY(0) scale(1); } }
          @keyframes lt-toast-out { to { opacity: 0; transform: translateY(4px) scale(.94); } }
        `;
        document.head.appendChild(style);
      }

      let container = document.getElementById("leetcode-tracker-toast-container");
      if (!container) {
        container = document.createElement("div");
        container.id = "leetcode-tracker-toast-container";
        document.body.appendChild(container);
      }

      const toast = document.createElement("div");
      toast.className = `lt-toast lt-toast-${type === "error" ? "error" : "success"}`;
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");

      // Apply theme class once to container for color variables
      const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
      const rootContainer = document.getElementById('leetcode-tracker-toast-container');
      if (rootContainer && !rootContainer.classList.contains('lt-theme-light') && !rootContainer.classList.contains('lt-theme-dark')) {
        rootContainer.classList.add(prefersDark ? 'lt-theme-dark' : 'lt-theme-light');
      }

      const icon = document.createElement('div');
      icon.className = 'lt-toast-icon';
      const iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      iconSvg.setAttribute('viewBox', '0 0 24 24');
      iconSvg.setAttribute('fill', 'none');
      iconSvg.setAttribute('stroke-width', '2');
      iconSvg.setAttribute('stroke-linecap', 'round');
      iconSvg.setAttribute('stroke-linejoin', 'round');

      const iconCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      iconCircle.setAttribute('cx', '12');
      iconCircle.setAttribute('cy', '12');
      iconCircle.setAttribute('r', '10');
      iconSvg.appendChild(iconCircle);

      if (type === 'error') {
        const iconLineOne = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        iconLineOne.setAttribute('x1', '15');
        iconLineOne.setAttribute('y1', '9');
        iconLineOne.setAttribute('x2', '9');
        iconLineOne.setAttribute('y2', '15');

        const iconLineTwo = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        iconLineTwo.setAttribute('x1', '9');
        iconLineTwo.setAttribute('y1', '9');
        iconLineTwo.setAttribute('x2', '15');
        iconLineTwo.setAttribute('y2', '15');

        iconSvg.appendChild(iconLineOne);
        iconSvg.appendChild(iconLineTwo);
      } else {
        const iconPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        iconPath.setAttribute('d', 'M8 12.5l3 3 5-6');
        iconSvg.appendChild(iconPath);
      }

      icon.appendChild(iconSvg);

      const text = document.createElement("div");
      text.style.flex = "1";
      text.textContent = message;

      const closeBtn = document.createElement("button");
      closeBtn.className = "lt-toast-close";
      closeBtn.textContent = "×";
      closeBtn.addEventListener("click", () => {
        toast.style.animation = "lt-toast-out .35s forwards";
        setTimeout(() => toast.remove(), 330);
      });

    toast.appendChild(icon);
    toast.appendChild(text);
      toast.appendChild(closeBtn);
      container.appendChild(toast);


      // Auto-remove after animation finishes (~4.55s)
      setTimeout(() => {
        if (document.body.contains(toast)) {
          toast.remove();
        }
    }, 5400);
    }

    /**
     * Display a modal popup for users to add comments about their solution.
     * Provides a rich UI experience with proper styling and interaction handling.
     *
     * Algorithm:
     * 1. Create modal overlay with dark background
     * 2. Build popup content with header, instruction text, and textarea
     * 3. Style components with inline CSS for consistency across sites
     * 4. Add interactive buttons (Skip/Save) with hover effects
     * 5. Handle user interactions: save comment, skip, or click outside to close
     * 6. Clean up DOM elements and resolve promise with user input
     *
     * UI Components:
     * - Modal overlay with semi-transparent background
     * - Centered popup with professional styling
     * - Branded header with LeetcodeTracker name
     * - Instructional text explaining the purpose
     * - Large textarea for multi-line comments
     * - Action buttons with hover states and proper spacing
     *
     * @returns {Promise<string>} User's comment text or empty string if skipped
     */
    showCommentPopup() {
      return new Promise((resolve) => {
        // Create modal overlay element
        const popup = document.createElement("div");
        popup.className = "leetcode-tracker-comment-popup";
        popup.style.cssText = `
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background-color: rgba(0, 0, 0, 0.7);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 10000;
        `;

        // Create main popup content container
        const popupContent = document.createElement("div");
        popupContent.style.cssText = `
          background-color: white;
          padding: 24px;
          border-radius: 12px;
          width: 90%;
          max-width: 500px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        `;

        // Create header section with branding
        const header = document.createElement("div");
        header.style.cssText = `
          display: flex;
          align-items: center;
          margin-bottom: 16px;
        `;

        const title = document.createElement("h3");
        title.textContent = "Leetcode";
        title.style.cssText = `
          margin: 0;
          font-size: 20px;
          font-weight: 700;
          color: #262626;
        `;

        const titleAccent = document.createElement("span");
        titleAccent.style.color = "#FFA116";
        titleAccent.textContent = "Tracker";
        title.appendChild(titleAccent);

        header.appendChild(title);

        // Create instruction text
        const instruction = document.createElement("p");
        instruction.textContent =
          "Add notes about your solution approach, time complexity, etc.";
        instruction.style.cssText = `
          color: #525252;
          font-size: 14px;
          margin-bottom: 16px;
          line-height: 1.5;
        `;

        // Create comment input textarea
        const textarea = document.createElement("textarea");
        textarea.style.cssText = `
          width: 100%;
          height: 150px;
          padding: 12px;
          box-sizing: border-box;
          border: 1px solid #E0E0E0;
          border-radius: 8px;
          color: rgb(0, 0, 0);
          font-family: inherit;
          font-size: 14px;
          margin-bottom: 20px;
          resize: vertical;
          background-color: #F5F5F5;
        `;
        textarea.placeholder =
          "Example: This solution uses a stack to keep track of...";

        // Create visual separator
        const separator = document.createElement("div");
        separator.style.cssText = `
          height: 1px;
          background-color: #E0E0E0;
          margin: 16px 0;
        `;

        // Create button container
        const buttonContainer = document.createElement("div");
        buttonContainer.style.cssText = `
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 16px;
        `;

        // Create Skip button
        const skipButton = document.createElement("button");
        skipButton.textContent = "Skip";
        skipButton.style.cssText = `
          padding: 8px 16px;
          background-color: white;
          color: #525252;
          border: 1px solid #E0E0E0;
          border-radius: 20px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: background-color 0.2s;
        `;

        // Add hover effects for Skip button
        skipButton.onmouseover = () => {
          skipButton.style.backgroundColor = "#F5F5F5";
        };
        skipButton.onmouseout = () => {
          skipButton.style.backgroundColor = "white";
        };

        // Create Save button
        const saveButton = document.createElement("button");
        saveButton.textContent = "Save Comment";
        saveButton.style.cssText = `
          padding: 8px 16px;
          background-color: #FFA116;
          color: white;
          border: none;
          border-radius: 20px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: opacity 0.2s;
        `;

        // Add hover effects for Save button
        saveButton.onmouseover = () => {
          saveButton.style.opacity = "0.9";
        };
        saveButton.onmouseout = () => {
          saveButton.style.opacity = "1";
        };

        // Assemble DOM structure
        buttonContainer.appendChild(skipButton);
        buttonContainer.appendChild(saveButton);

        popupContent.appendChild(header);
        popupContent.appendChild(instruction);
        popupContent.appendChild(textarea);
        popupContent.appendChild(separator);
        popupContent.appendChild(buttonContainer);

        popup.appendChild(popupContent);
        document.body.appendChild(popup);

        // Focus on textarea for immediate typing
        setTimeout(() => textarea.focus(), 100);

        // Handle Skip button click
        skipButton.addEventListener("click", () => {
          document.body.removeChild(popup);
          resolve(""); // Resolve with empty string if user skips
        });

        // Handle Save button click
        saveButton.addEventListener("click", () => {
          const comment = textarea.value.trim();
          document.body.removeChild(popup);
          resolve(comment); // Resolve with user's comment
        });

        // Handle click outside popup to close
        popup.addEventListener("click", (e) => {
          if (e.target === popup) {
            document.body.removeChild(popup);
            resolve("");
          }
        });
      });
    }
  }
