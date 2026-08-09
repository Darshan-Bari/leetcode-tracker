/**
 * DOM element references for the extension popup interface.
 * Centralizes all DOM queries for better maintainability and performance.
 */
const DOM = {
  authenticate: document.getElementById("authenticate"),
  authenticateButton: document.getElementById("github-authenticate-button"),
  hookRepo: document.getElementById("hook-repo"),
  authenticated: document.getElementById("authenticated"),
  repoName: document.getElementById("repo-name"),
  subfolderPath: document.getElementById("subfolder-path"),
  repoNameError: document.getElementById("repo-name-error"),
  repoForm: document.getElementById("repo-form"),
  hookButton: document.getElementById("hook-button"),
  unlinkButton: document.getElementById("unlink-button"),
  repositoryName: document.getElementById("repository-name"),
  repositoryLink: document.getElementById("repository-link"),
  githubUsername: document.getElementById("github-username"),
  logoutButton: document.getElementById("logout-button"),
  changeAccountButton: document.getElementById("change-account-button"),
  checkboxCodeSubmitSetting: document.getElementById("submit-code-checkbox"),
  checkboxSyncMultipleSubmissions: document.getElementById(
    "multiple-submission-checkbox"
  ),
  checkboxCommentSubmission: document.getElementById(
    "comment-submission-checkbox"
  ),
  syncButton: document.getElementById("sync-button"),
  syncStatus: document.getElementById("sync-status"),
  syncTime: document.getElementById("sync-time"),
};

/**
 * Main controller class for the browser extension popup interface.
 * Manages authentication flow, repository linking, settings, and synchronization status.
 */
class PopupManager {
  /**
   * Initialize the popup manager with all required components.
   * Sets up event listeners, settings synchronization, and background sync status monitoring.
   */
  constructor() {
    this.initializeEventListeners();
    this.initializeSetting();

    this.updateSyncStatus();
    this.syncStatusInterval = setInterval(() => this.updateSyncStatus(), 2000);
  }

  /**
   * Load and synchronize all user settings from browser storage to UI controls.
   * Ensures the popup displays current setting states correctly.
   */
  async initializeSetting() {
    const codeSubmitResult = await browser.storage.local.get("leetcode_tracker_code_submit");
    DOM.checkboxCodeSubmitSetting.checked = codeSubmitResult.leetcode_tracker_code_submit;

    const multiResult = await browser.storage.local.get("leetcode_tracker_sync_multiple_submission");
    DOM.checkboxSyncMultipleSubmissions.checked = multiResult.leetcode_tracker_sync_multiple_submission;

    const commentResult = await browser.storage.local.get("leetcode_tracker_comment_submission");
    DOM.checkboxCommentSubmission.checked = commentResult.leetcode_tracker_comment_submission;
  }

  /**
   * Toggle the setting for syncing old problems that were solved before extension installation.
   * Provides backward compatibility for existing LeetCode solutions.
   */
  async toggleSyncOldProblemsSetting() {
    const result = await browser.storage.local.get("leetcode_tracker_sync_old_problems");
    const syncOldProblems =
      result.leetcode_tracker_sync_old_problems !== undefined
        ? result.leetcode_tracker_sync_old_problems
        : false;

    await browser.storage.local.set({
      leetcode_tracker_sync_old_problems: !syncOldProblems,
    });

    this.initializeSetting();
  }

  /**
   * Toggle the code submission setting with dependent setting management.
   * When disabled, automatically disables multiple submissions and comments
   * to maintain logical consistency.
   *
   * Algorithm:
   * 1. Get current code submit setting state
   * 2. Invert the setting value
   * 3. If disabling code submit, also disable dependent features
   * 4. Update storage and refresh UI
   */
  async toggleCodeSubmitSetting() {
    const result = await browser.storage.local.get("leetcode_tracker_code_submit");
    const codeSubmit = result.leetcode_tracker_code_submit;
    await browser.storage.local.set({
      leetcode_tracker_code_submit: !codeSubmit,
    });

    // Disable dependent settings when code submit is disabled
    if (!codeSubmit) {
      await browser.storage.local.set({
        leetcode_tracker_sync_multiple_submission: false,
        leetcode_tracker_comment_submission: false,
      });
    }

    this.initializeSetting();
  }

  /**
   * Toggle multiple submission synchronization with dependency management.
   * Handles complex interdependencies between settings to prevent invalid states.
   *
   * Settings Dependencies:
   * - When enabling: Disables code submit to prevent conflicts
   * - When disabling: Disables comment submission (requires multiple submissions)
   */
  async toggleSyncMultipleSubmissionSetting() {
    const result = await browser.storage.local.get("leetcode_tracker_sync_multiple_submission");
    const isSync = result.leetcode_tracker_sync_multiple_submission;
    await browser.storage.local.set({
      leetcode_tracker_sync_multiple_submission: !isSync,
    });

    if (!isSync) {
      // Enabling multiple submissions - disable conflicting settings
      await browser.storage.local.set({
        leetcode_tracker_code_submit: false,
      });
    } else {
      // Disabling multiple submissions - disable dependent settings
      await browser.storage.local.set({
        leetcode_tracker_comment_submission: false,
      });
    }

    this.initializeSetting();
  }

  /**
   * Toggle comment submission setting with prerequisite validation.
   * Comments require multiple submission mode, so enabling comments
   * automatically configures the required dependencies.
   */
  async toggleCommentSubmissionSetting() {
    const result = await browser.storage.local.get("leetcode_tracker_comment_submission");
    const isCommentEnabled = result.leetcode_tracker_comment_submission;
    await browser.storage.local.set({
      leetcode_tracker_comment_submission: !isCommentEnabled,
    });

    if (!isCommentEnabled) {
      // Enabling comments requires multiple submissions
      await browser.storage.local.set({
        leetcode_tracker_code_submit: false,
        leetcode_tracker_sync_multiple_submission: true,
      });
    }

    this.initializeSetting();
  }

  /**
   * Set up all event listeners for the popup interface.
   * Includes DOM event handlers and browser extension message listeners.
   */
  initializeEventListeners() {
    document.addEventListener("DOMContentLoaded", this.setupLinks.bind(this));
    DOM.authenticateButton.addEventListener(
      "click",
      this.handleAuthentication.bind(this)
    );
    DOM.repoForm.addEventListener("submit", (event) => {
      event.preventDefault();
      this.handleHookRepo();
    });
    DOM.unlinkButton.addEventListener("click", this.unlinkRepo.bind(this));
    DOM.logoutButton.addEventListener("click", this.logout.bind(this));
    DOM.changeAccountButton.addEventListener("click", this.logout.bind(this));
    DOM.checkboxCodeSubmitSetting.addEventListener(
      "click",
      this.toggleCodeSubmitSetting.bind(this)
    );
    DOM.checkboxSyncMultipleSubmissions.addEventListener(
      "click",
      this.toggleSyncMultipleSubmissionSetting.bind(this)
    );
    DOM.checkboxCommentSubmission.addEventListener(
      "click",
      this.toggleCommentSubmissionSetting.bind(this)
    );
    DOM.syncButton.addEventListener("click", this.startManualSync.bind(this));
  }

  /**
   * Update the sync button without replacing its trusted DOM structure.
   *
   * @param {boolean} inProgress Whether synchronization is active.
   */
  setSyncButtonState(inProgress) {
    DOM.syncButton.disabled = inProgress;
    DOM.syncButton.querySelector("svg")?.classList.toggle("spin", inProgress);
    const label = DOM.syncButton.querySelector("span");
    if (label) label.textContent = inProgress ? "Syncing..." : "Sync";
  }

  /**
   * Initiate manual synchronization of all solved problems.
   * Updates UI to show progress and sends sync command to background script.
   *
   * Algorithm:
   * 1. Disable sync button to prevent multiple concurrent syncs
   * 2. Replace button content with animated loading indicator
   * 3. Inject CSS animation for loading spinner
   * 4. Send sync message to background script
   * 5. Update sync status display
   */
  async startManualSync() {
    this.setSyncButtonState(true);
    DOM.syncStatus.className = "";
    DOM.syncStatus.textContent = "Starting synchronization...";

    try {
      await browser.runtime.sendMessage({ type: "syncSolvedProblems" });
      window.setTimeout(() => this.updateSyncStatus(), 250);
    } catch (error) {
      this.setSyncButtonState(false);
      DOM.syncStatus.className = "text-danger";
      DOM.syncStatus.textContent = `Unable to start sync: ${
        error.message || "Background service unavailable"
      }`;
    }
  }

  /**
   * Update the synchronization status display with current progress and results.
   * Monitors background sync process and updates UI accordingly.
   *
   * Algorithm:
   * 1. Fetch sync status data from browser storage
   * 2. Update button state based on sync progress
   * 3. Display appropriate status message and styling
   * 4. Show formatted timestamp of last sync operation
   * 5. Handle error cases and edge states gracefully
   */
  async updateSyncStatus() {
    try {
      const result = await browser.storage.local.get([
        "leetcode_tracker_sync_in_progress",
        "leetcode_tracker_last_sync_status",
        "leetcode_tracker_last_sync_message",
        "leetcode_tracker_last_sync_date",
      ]);

      const inProgress = Boolean(result.leetcode_tracker_sync_in_progress);
      const lastStatus = result.leetcode_tracker_last_sync_status || "";
      const lastMessage = result.leetcode_tracker_last_sync_message || "";
      const parsedDate = result.leetcode_tracker_last_sync_date
        ? new Date(result.leetcode_tracker_last_sync_date)
        : null;
      const lastDate =
        parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : null;

      DOM.syncStatus.className = "";
      DOM.syncTime.className = "";

      if (inProgress) {
        this.setSyncButtonState(true);
        DOM.syncStatus.textContent = lastMessage || "Synchronization in progress...";
      } else {
        this.setSyncButtonState(false);

        if (lastStatus === "success") {
          DOM.syncStatus.textContent = lastMessage || "Last sync completed successfully";
          DOM.syncStatus.className = "text-success";
        } else if (lastStatus === "partial") {
          DOM.syncStatus.textContent = lastMessage || "Last sync completed with some failures";
          DOM.syncStatus.className = "text-danger";
        } else if (lastStatus === "failed") {
          DOM.syncStatus.textContent = lastMessage
            ? `Last sync failed: ${lastMessage}`
            : "Last sync failed";
          DOM.syncStatus.className = "text-danger";
        } else {
          DOM.syncStatus.textContent = "No synchronization performed yet";
          DOM.syncStatus.className = "text-muted";
        }
      }

      if (lastDate) {
        DOM.syncTime.textContent = this.formatDate(lastDate);
        DOM.syncTime.className = "text-muted";
      } else {
        DOM.syncTime.textContent = "";
      }
    } catch (error) {
      DOM.syncButton.disabled = false;
      DOM.syncStatus.textContent = "Sync status is temporarily unavailable";
      DOM.syncStatus.className = "text-muted";
      DOM.syncTime.textContent = "";
      DOM.syncTime.className = "";
    }
  }

  /**
   * Format a date object into a human-readable relative time string.
   * Provides intuitive time descriptions (e.g., "2 minutes ago", "Just now").
   *
   * @param {Date} date - The date to format
   * @returns {string} Human-readable relative time string
   */
  formatDate(date) {
    if (!date) return "";

    const now = new Date();
    const diffMs = now - date;
    const diffSeconds = Math.floor(diffMs / 1000);

    if (diffSeconds < 60) {
      return "Just now";
    } else if (diffSeconds < 3600) {
      const minutes = Math.floor(diffSeconds / 60);
      return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`;
    } else if (diffSeconds < 86400) {
      const hours = Math.floor(diffSeconds / 3600);
      return `${hours} ${hours === 1 ? "hour" : "hours"} ago`;
    } else {
      return date.toLocaleString();
    }
  }

  /**
   * Configure external links to open in new tabs.
   * Prevents navigation away from the popup interface.
   */
  setupLinks() {
    document.querySelectorAll("a.link, #repository-link").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        browser.tabs.create({ active: true, url: link.href });
      });
    });
  }

  /**
   * Check the current authentication status and display appropriate UI state.
   * Determines which section of the popup should be visible based on user progress.
   *
   * State Machine:
   * - No token/username → Show authentication section
   * - Has token but no repo → Show repository setup section
   * - Fully configured → Show main authenticated interface
   */
  async checkAuthStatus() {
    const result = await browser.storage.local.get([
      "leetcode_tracker_token",
      "leetcode_tracker_username",
      "leetcode_tracker_mode",
      "leetcode_tracker_repo",
    ]);

    [DOM.authenticate, DOM.hookRepo, DOM.authenticated].forEach((panel) => {
      panel.style.display = "none";
    });

    if (!result.leetcode_tracker_token || !result.leetcode_tracker_username) {
      DOM.authenticate.style.display = "block";
    } else if (!result.leetcode_tracker_repo || !result.leetcode_tracker_mode) {
      DOM.hookRepo.style.display = "block";
    } else {
      DOM.authenticated.style.display = "flex";
    }

    await this.updateUserInfos();
  }

  /**
   * Log out the user by clearing all stored data and resetting UI state.
   * Provides complete cleanup for account switching or privacy.
   */
  async logout() {
    try {
      await browser.storage.local.clear();

      DOM.authenticate.style.display = "block";
      DOM.hookRepo.style.display = "none";
      DOM.authenticated.style.display = "none";
    } catch (error) {
      // Handle logout errors gracefully
    }
  }

  /**
   * Update the user information display with current GitHub username and repository.
   * Constructs the repository link for easy access to the GitHub repository.
   */
  async updateUserInfos() {
    const {
      leetcode_tracker_repo,
      leetcode_tracker_username,
      leetcode_tracker_subfolder,
      leetcode_tracker_default_branch,
    } = await browser.storage.local.get([
      "leetcode_tracker_repo",
      "leetcode_tracker_username",
      "leetcode_tracker_subfolder",
      "leetcode_tracker_default_branch",
    ]);

    if (leetcode_tracker_repo) {
      DOM.repositoryName.textContent = leetcode_tracker_subfolder
        ? `${leetcode_tracker_repo} / ${leetcode_tracker_subfolder}`
        : leetcode_tracker_repo;
    }
    if (leetcode_tracker_username) {
      DOM.githubUsername.textContent = leetcode_tracker_username;
    }
    if (leetcode_tracker_username && leetcode_tracker_repo) {
      const encodedSubfolder = (leetcode_tracker_subfolder || "")
        .split("/")
        .filter(Boolean)
        .map(encodeURIComponent)
        .join("/");
      const branch = encodeURIComponent(
        leetcode_tracker_default_branch || "main"
      );
      const subfolderSegment = encodedSubfolder
        ? `/tree/${branch}/${encodedSubfolder}`
        : "";
      DOM.repositoryLink.href = `https://github.com/${encodeURIComponent(
        leetcode_tracker_username
      )}/${encodeURIComponent(leetcode_tracker_repo)}${subfolderSegment}`;
    }
  }

  /**
   * Handle GitHub authentication by opening OAuth flow in new tab.
   * Delegates the complete flow to the background script.
   */
  async handleAuthentication() {
    const label = DOM.authenticateButton.querySelector("span");
    const originalText = label?.textContent || "Authenticate";
    DOM.authenticateButton.disabled = true;
    if (label) label.textContent = "Connecting...";

    try {
      const response = await browser.runtime.sendMessage({
        type: "startGitHubAuthentication",
      });

      if (!response?.success) {
        throw new Error(
          response?.error || "GitHub authentication could not be completed."
        );
      }

      await this.checkAuthStatus();
    } catch (error) {
      alert(
        `Authentication failed: ${error.message || "Could not connect to background service."}`
      );
    } finally {
      DOM.authenticateButton.disabled = false;
      if (label) label.textContent = originalText;
    }
  }

  /**
   * Handle repository setup and validation process.
   * Validates user input and attempts to link the specified repository.
   */
  async handleHookRepo() {
    const repositoryName = DOM.repoName.value.trim();
    const label = DOM.hookButton.querySelector("span");
    const originalText = label?.textContent || "Link repository";
    DOM.repoNameError.textContent = "";

    if (!repositoryName) {
      DOM.repoNameError.textContent = "Please enter a repository name";
      DOM.repoName.focus();
      return;
    }

    // Sanitize subfolder path
    let subfolderPath = (DOM.subfolderPath.value || "").trim();
    subfolderPath = subfolderPath.replace(/^\/+|\/+$/g, "");
    subfolderPath = subfolderPath.replace(/\/\/+/g, "/");

    DOM.hookButton.disabled = true;
    if (label) label.textContent = "Linking...";

    try {
      const result = await browser.storage.local.get([
        "leetcode_tracker_token",
        "leetcode_tracker_username",
      ]);

      await this.linkRepo(result, repositoryName, subfolderPath);
    } catch (error) {
      DOM.repoNameError.textContent =
        error.message || "An error occurred while linking the repository";
    } finally {
      DOM.hookButton.disabled = false;
      if (label) label.textContent = originalText;
    }
  }

  /**
   * Link and validate a GitHub repository for synchronization.
   * Verifies repository exists and user has appropriate access permissions.
   *
   * Algorithm:
   * 1. Extract authentication data and repository name
   * 2. Get API configuration from background script
   * 3. Make authenticated request to GitHub API to verify repository
   * 4. Handle authentication errors by logging out user
   * 5. Store repository configuration on successful validation
   * 6. Update UI to show authenticated state
   *
   * @param {Object} githubAuthData - Authentication data with token and username
   * @param {string} repositoryName - Name of repository to link
   */
  async linkRepo(githubAuthData, repositoryName, subfolderPath = "") {
    const { leetcode_tracker_token, leetcode_tracker_username } =
      githubAuthData;
    const dataConfig = await browser.runtime.sendMessage({
      type: "getDataConfig",
    });

    try {
      const response = await fetch(
        `${dataConfig.REPOSITORY_URL}${leetcode_tracker_username}/${repositoryName}`,
        {
          method: "GET",
          headers: {
            ...dataConfig.HEADERS,
            Authorization: `token ${leetcode_tracker_token}`,
          },
        }
      );

      const result = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          this.logout();
        }

        throw new Error(result.message);
      }

      await browser.storage.local.set({
        leetcode_tracker_mode: "commit",
        leetcode_tracker_repo: repositoryName,
        leetcode_tracker_subfolder: subfolderPath,
        leetcode_tracker_default_branch: result.default_branch || "main",
      });

      await this.updateUserInfos();
      DOM.hookRepo.style.display = "none";
      DOM.authenticated.style.display = "flex";
    } catch (error) {
      const message = error?.message || "";
      if (
        error instanceof TypeError ||
        /NetworkError|Failed to fetch/i.test(message)
      ) {
        throw new Error(
          "GitHub is unreachable. Check your connection, then reload the extension and try linking again."
        );
      }
      throw error;
    }
  }

  /**
   * Unlink the current repository and return to repository setup state.
   * Allows users to change repositories without full logout.
   */
  async unlinkRepo() {
    try {
      await browser.storage.local.remove([
        "leetcode_tracker_mode",
        "leetcode_tracker_repo",
        "leetcode_tracker_subfolder",
        "leetcode_tracker_default_branch",
      ]);
      DOM.authenticated.style.display = "none";
      DOM.hookRepo.style.display = "block";
    } catch (error) {
      // Handle unlink errors gracefully
    }
  }
}

// Initialize the popup manager and check authentication status
const popupManager = new PopupManager();
popupManager.checkAuthStatus();
