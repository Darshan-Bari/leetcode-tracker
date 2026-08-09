import { ENV } from "./environment.js";
import SyncService from "./scripts/services/sync-service.js";
import GitHubAuthService from "./scripts/services/github-auth-service.js";
import BackendAuthService from "./scripts/services/backend-auth-service.js";
import "./scripts/gta-background.js";

// Intercept outgoing LeetCode background requests to attach Referer, Cookie, and CSRF headers
const webRequestApi =
  typeof browser !== "undefined" && browser.webRequest
    ? browser.webRequest
    : typeof chrome !== "undefined" && chrome.webRequest
    ? chrome.webRequest
    : null;
const cookieApi =
  typeof browser !== "undefined" && browser.cookies
    ? browser.cookies
    : typeof chrome !== "undefined" && chrome.cookies
    ? chrome.cookies
    : null;

if (webRequestApi && webRequestApi.onBeforeSendHeaders) {
  webRequestApi.onBeforeSendHeaders.addListener(
    async (details) => {
      const headers = details.requestHeaders || [];
      let hasReferer = false;
      let hasCookie = false;
      let csrfToken = "";

      for (const h of headers) {
        const name = h.name.toLowerCase();
        if (name === "referer") hasReferer = true;
        if (name === "cookie") hasCookie = true;
      }

      if (!hasReferer) {
        headers.push({ name: "Referer", value: "https://leetcode.com" });
      }

      if (!hasCookie && cookieApi) {
        try {
          let cookies = await cookieApi.getAll({ url: "https://leetcode.com" });
          if (!cookies || cookies.length === 0) {
            cookies = await cookieApi.getAll({ domain: "leetcode.com" });
          }
          if (cookies && cookies.length > 0) {
            const cookieStr = cookies
              .map((c) => `${c.name}=${c.value}`)
              .join("; ");
            headers.push({ name: "Cookie", value: cookieStr });

            const csrfCookie = cookies.find((c) => c.name === "csrftoken");
            if (csrfCookie) csrfToken = csrfCookie.value;
          }
        } catch (e) {
          console.warn("webRequest cookie retrieval error:", e);
        }
      }

      if (csrfToken && details.method === "POST") {
        const hasCsrf = headers.some(
          (h) => h.name.toLowerCase() === "x-csrftoken"
        );
        if (!hasCsrf) {
          headers.push({ name: "x-csrftoken", value: csrfToken });
        }
      }

      return { requestHeaders: headers };
    },
    { urls: ["https://leetcode.com/*"] },
    ["blocking", "requestHeaders"]
  );
}

const GITHUB_API_CONFIG = {
  REPOSITORY_URL: "https://api.github.com/repos/",
  USER_INFO_URL: "https://api.github.com/user",
  HEADERS: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
};

const DATA_CONFIG = {
  ...ENV,
  ...GITHUB_API_CONFIG,
};


/**
 * Main controller for the LeetCode Tracker background script.
 * Orchestrates all background services and handles browser extension messaging.
 */
class LeetCodeTrackerController {
  /**
   * Initialize the controller with all required services and configuration.
   * Sets up synchronization, GitHub integration, and browser storage defaults.
   */
  constructor() {
    this.syncService = new SyncService();
    this.githubAuthService = new GitHubAuthService({
      env: ENV,
      backendAuthService: new BackendAuthService({ authUrl: ENV.BACKEND_AUTH_URL }),
    });

    // Store environment configuration for other components
    browser.storage.local.set({ leetcode_tracker_data_config: DATA_CONFIG });

    // Preserve completed sync history across background restarts and recover
    // cleanly if a previous worker stopped during an active synchronization.
    this.syncStatusReady = this.initializeSyncStatus().catch((error) => {
      console.error("Unable to initialize sync status:", error);
    });

    this.initializeMessageListeners();
  }

  /**
   * Initialize missing sync status fields without erasing completed history.
   * A running sync cannot survive a background worker restart, so stale
   * in-progress state is converted into an actionable failure message.
   */
  async initializeSyncStatus() {
    const keys = [
      "leetcode_tracker_last_sync_status",
      "leetcode_tracker_sync_in_progress",
      "leetcode_tracker_last_sync_message",
      "leetcode_tracker_last_sync_date",
    ];
    const result = await browser.storage.local.get(keys);
    const updates = {};

    if (result.leetcode_tracker_sync_in_progress) {
      updates.leetcode_tracker_sync_in_progress = false;
      updates.leetcode_tracker_last_sync_status = "failed";
      updates.leetcode_tracker_last_sync_message =
        "Synchronization was interrupted. Please try again.";
      updates.leetcode_tracker_last_sync_date = new Date().toISOString();
    } else {
      if (result.leetcode_tracker_sync_in_progress === undefined) {
        updates.leetcode_tracker_sync_in_progress = false;
      }
      if (result.leetcode_tracker_last_sync_status === undefined) {
        updates.leetcode_tracker_last_sync_status = "";
      }
      if (result.leetcode_tracker_last_sync_message === undefined) {
        updates.leetcode_tracker_last_sync_message =
          "No synchronization performed yet";
      }
      if (result.leetcode_tracker_last_sync_date === undefined) {
        updates.leetcode_tracker_last_sync_date = null;
      }
    }

    if (Object.keys(updates).length > 0) {
      await browser.storage.local.set(updates);
    }
  }

  /**
   * Set up browser extension message listeners for UI communication.
   * Handles configuration, authentication, and synchronization requests.
   */
  initializeMessageListeners() {
    browser.runtime.onMessage.addListener((request, sender) => {
      const handlers = {
        getDataConfig: () => {
          return Promise.resolve(DATA_CONFIG);
        },
        getStorageConfig: async () => {
          const result = await browser.storage.local.get(request.properties);
          return result;
        },
        saveUserInfos: async () => {
          await this.saveUserInfos(request);
          return { success: true };
        },
        startGitHubAuthentication: async () => {
          return this.authenticateWithGitHub();
        },
        syncSolvedProblems: async () => {
          await this.syncStatusReady;
          this.startSync();
          return { status: "started" };
        },
      };

      if (handlers[request.type]) {
        return handlers[request.type]();
      }
    });
  }

  /**
   * Save user authentication information to browser storage.
   * Stores GitHub username and access token for API authentication.
   *
   * @param {Object} request - Request object containing username and token
   */
  async saveUserInfos(request) {
    await browser.storage.local.set({
      leetcode_tracker_username: request.username,
      leetcode_tracker_token: request.token,
    });
  }

  /**
   * Start the GitHub authentication flow and persist the resulting session.
   *
   * @returns {Promise<Object>} Success status and user details.
   */
  async authenticateWithGitHub() {
    try {
      const session = await this.githubAuthService.authenticate();

      await this.saveUserInfos({
        username: session.username,
        token: session.accessToken,
      });

      return { success: true, username: session.username };
    } catch (error) {
      console.error("GitHub authentication failed:", error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start the synchronization process and track progress.
   *
   * @returns {Promise<Object>} Sync result with success status and message
   */
  async startSync() {
    try {
      return await this.syncService.startSync();
    } catch (error) {
      await browser.storage.local.set({
        leetcode_tracker_last_sync_status: "failed",
        leetcode_tracker_sync_in_progress: false,
        leetcode_tracker_last_sync_message: error.message,
        leetcode_tracker_last_sync_date: new Date().toISOString(),
      });

      return {
        success: false,
        message: "Error during synchronization: " + error.message,
      };
    }
  }
}

/**
 * Extension installation and update handler.
 * Sets up default settings for new installations and updates.
 */
browser.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install" || details.reason === "update") {
    // Initialize default settings only if they don't exist
    const codeSubmitResult = await browser.storage.local.get("leetcode_tracker_code_submit");
    if (codeSubmitResult.leetcode_tracker_code_submit === undefined) {
      await browser.storage.local.set({
        leetcode_tracker_code_submit: true,
      });
    }

    const multipleSubmResult = await browser.storage.local.get("leetcode_tracker_sync_multiple_submission");
    if (multipleSubmResult.leetcode_tracker_sync_multiple_submission === undefined) {
      await browser.storage.local.set({
        leetcode_tracker_sync_multiple_submission: false,
      });
    }

    const commentResult = await browser.storage.local.get("leetcode_tracker_comment_submission");
    if (commentResult.leetcode_tracker_comment_submission === undefined) {
      await browser.storage.local.set({
        leetcode_tracker_comment_submission: false,
      });
    }

    const autoSyncResult = await browser.storage.local.get("leetcode_tracker_auto_sync");
    if (autoSyncResult.leetcode_tracker_auto_sync === undefined) {
      await browser.storage.local.set({
        leetcode_tracker_auto_sync: true,
      });
    }
  }
});

// Initialize the main controller
new LeetCodeTrackerController();
