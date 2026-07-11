import { ENV } from "../../environment.js";
import BackendAuthService from "./backend-auth-service.js";

const GITHUB_USER_INFO_URL = "https://api.github.com/user";

/**
 * Orchestrates the full GitHub OAuth flow inside the extension.
 * It generates and validates state, opens the authorization screen, sends the
 * code to the backend, and resolves the authenticated GitHub user.
 */
export default class GitHubAuthService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.env] OAuth configuration.
   * @param {BackendAuthService} [options.backendAuthService] Backend exchange service.
   */
  constructor({ env = ENV, backendAuthService } = {}) {
    this.env = env;
    this.backendAuthService = backendAuthService || new BackendAuthService({ authUrl: env.BACKEND_AUTH_URL });
    this.oauthTransaction = null;
  }

  /**
   * Start the OAuth login flow and return the authenticated session.
   *
   * @returns {Promise<Object>} Session data containing the GitHub token and username.
   */
  async authenticate() {
    this.validateConfiguration();

    console.debug("[OAuth] Before OAuth");
    const transaction = await this.createOAuthTransaction();

    try {
      const authorizationUrl = this.buildAuthorizationUrl(transaction);
      const callbackUrl = await this.openAuthorizationFlow(authorizationUrl);
      
      console.debug("[OAuth] After redirect");
      const { code, returnedState } = this.parseCallbackUrl(callbackUrl);

      if (returnedState !== transaction.state) {
        throw new Error("OAuth state validation failed.");
      }

      const backendResponse = await this.backendAuthService.exchangeCode({
        code,
        state: transaction.state,
        redirectUri: this.env.REDIRECT_URL,
        clientId: this.env.CLIENT_ID,
        codeVerifier: transaction.codeVerifier,
      });

      const accessToken =
        backendResponse.access_token ||
        backendResponse.accessToken ||
        backendResponse.token;

      if (!accessToken) {
        throw new Error("The backend did not return a GitHub access token.");
      }

      const username =
        backendResponse.user?.login ||
        backendResponse.username ||
        (await this.fetchGitHubUsername(accessToken));

      return {
        accessToken,
        username,
        backendResponse,
      };
    } finally {
      this.clearOAuthTransaction();
    }
  }

  /**
   * Validate required configuration before starting the flow.
   */
  validateConfiguration() {
    const isPlaceholderValue = (value) => !value || value === "YOUR_CLIENT_ID";

    if (isPlaceholderValue(this.env.CLIENT_ID)) {
      throw new Error(
        "GitHub OAuth is not configured. Set CLIENT_ID in environment.js and configure the backend OAuth app."
      );
    }

    if (!this.env.AUTH_URL || !this.env.REDIRECT_URL) {
      throw new Error("GitHub OAuth endpoints are not configured.");
    }
  }

  /**
   * Create and store a temporary OAuth transaction.
   *
   * @returns {Promise<{state: string, codeVerifier: string, codeChallenge: string}>}
   */
  async createOAuthTransaction() {
    const state = this.generateRandomToken(32);
    const codeVerifier = this.generateRandomToken(96);
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);

    this.oauthTransaction = {
      state,
      codeVerifier,
      codeChallenge,
      createdAt: Date.now(),
    };

    return this.oauthTransaction;
  }

  /**
   * Clear any stored OAuth transaction data.
   */
  clearOAuthTransaction() {
    this.oauthTransaction = null;
  }

  /**
   * Create a cryptographically secure random state value.
   *
   * @returns {string} URL-safe random state string.
   */
  generateRandomToken(byteLength) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    if (byteLength !== bytes.length) {
      const randomBytes = new Uint8Array(byteLength);
      crypto.getRandomValues(randomBytes);
      return this.base64UrlEncode(randomBytes);
    }

    return this.base64UrlEncode(bytes);
  }

  /**
   * Encode bytes using URL-safe base64 without padding.
   *
   * @param {Uint8Array} bytes Binary data.
   * @returns {string} URL-safe encoded value.
   */
  base64UrlEncode(bytes) {
    let binary = "";

    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }

    return btoa(binary)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  /**
   * Create the PKCE code challenge for the given verifier.
   *
   * @param {string} codeVerifier PKCE code verifier.
   * @returns {Promise<string>} PKCE code challenge.
   */
  async generateCodeChallenge(codeVerifier) {
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return this.base64UrlEncode(new Uint8Array(hash));
  }

  /**
   * Build the GitHub authorization URL.
   *
   * @param {string} state Random state token.
   * @returns {string} Full GitHub authorize URL.
   */
  buildAuthorizationUrl(transaction) {
    const params = new URLSearchParams({
      client_id: this.env.CLIENT_ID,
      redirect_uri: this.env.REDIRECT_URL,
      scope: this.env.SCOPES.join(" "),
      state: transaction.state,
      code_challenge: transaction.codeChallenge,
      code_challenge_method: "S256",
    });

    return `${this.env.AUTH_URL}?${params.toString()}`;
  }

  /**
   * Open the OAuth authorization flow using the best available browser API.
   *
   * @param {string} authorizationUrl GitHub authorize URL.
   * @returns {Promise<string>} Redirect URL containing the authorization code.
   */
  async openAuthorizationFlow(authorizationUrl) {
    if (browser.identity?.launchWebAuthFlow) {
      return browser.identity.launchWebAuthFlow({
        interactive: true,
        url: authorizationUrl,
      });
    }

    return this.openTabBasedFlow(authorizationUrl);
  }

  /**
   * Fallback OAuth flow that watches a temporary tab until the redirect lands.
   *
   * @param {string} authorizationUrl GitHub authorize URL.
   * @returns {Promise<string>} Redirect URL captured from the tab.
   */
  async openTabBasedFlow(authorizationUrl) {
    return new Promise((resolve, reject) => {
      let tabId = null;
      let completed = false;

      const cleanup = async () => {
        browser.tabs.onUpdated.removeListener(handleUpdated);
        browser.tabs.onRemoved.removeListener(handleRemoved);

        if (tabId !== null) {
          try {
            await browser.tabs.remove(tabId);
          } catch (_) {
            // Ignore tab cleanup failures.
          }
        }
      };

      const finish = async (callbackUrl) => {
        if (completed) {
          return;
        }

        completed = true;
        await cleanup();
        resolve(callbackUrl);
      };

      const fail = async (error) => {
        if (completed) {
          return;
        }

        completed = true;
        await cleanup();
        reject(error);
      };

      const isRedirectUrl = (url) => {
        try {
          const currentUrl = new URL(url);
          const redirectUrl = new URL(this.env.REDIRECT_URL);
          return (
            currentUrl.origin === redirectUrl.origin &&
            currentUrl.pathname === redirectUrl.pathname
          );
        } catch (_) {
          return false;
        }
      };

      const handleUpdated = (_updatedTabId, changeInfo) => {
        if (tabId === null || _updatedTabId !== tabId || !changeInfo.url) {
          return;
        }

        if (isRedirectUrl(changeInfo.url)) {
          finish(changeInfo.url).catch(() => {});
        }
      };

      const handleRemoved = (removedTabId) => {
        if (tabId !== null && removedTabId === tabId) {
          fail(new Error("OAuth tab was closed before authentication completed.")).catch(() => {});
        }
      };

      browser.tabs.onUpdated.addListener(handleUpdated);
      browser.tabs.onRemoved.addListener(handleRemoved);

      browser.tabs
        .create({ url: authorizationUrl, active: true })
        .then((tab) => {
          tabId = tab.id;
        })
        .catch((error) => {
          fail(new Error(`Unable to open the OAuth tab: ${error.message}`)).catch(() => {});
        });
    });
  }

  /**
   * Parse the authorization response URL.
   *
   * @param {string} callbackUrl Redirect URL returned by the browser.
   * @returns {{code: string, returnedState: string | null}} Parsed OAuth payload.
   */
  parseCallbackUrl(callbackUrl) {
    const parsedUrl = new URL(callbackUrl);
    const code = parsedUrl.searchParams.get("code");
    const returnedState = parsedUrl.searchParams.get("state");
    const error = parsedUrl.searchParams.get("error");
    const errorDescription = parsedUrl.searchParams.get("error_description");

    if (error) {
      throw new Error(errorDescription || error);
    }

    if (!code) {
      throw new Error("GitHub did not return an authorization code.");
    }

    return { code, returnedState };
  }

  /**
   * Resolve the GitHub username from the access token.
   *
   * @param {string} accessToken GitHub access token.
   * @returns {Promise<string>} GitHub login name.
   */
  async fetchGitHubUsername(accessToken) {
    const response = await fetch(GITHUB_USER_INFO_URL, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `token ${accessToken}`,
      },
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        payload.message || `Unable to fetch GitHub user info (${response.status}).`
      );
    }

    if (!payload.login) {
      throw new Error("GitHub user info response did not include a login.");
    }

    return payload.login;
  }
}