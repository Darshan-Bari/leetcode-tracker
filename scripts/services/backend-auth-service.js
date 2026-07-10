const DEFAULT_BACKEND_AUTH_URL = "https://your-backend/auth/github";

/**
 * Handles the backend-side OAuth exchange.
 * The extension sends the GitHub authorization code here; the backend owns the
 * client secret and exchanges the code for a GitHub access token.
 */
export default class BackendAuthService {
  /**
   * @param {Object} [options]
   * @param {string} [options.authUrl] Backend endpoint used to exchange the code.
   * @param {Function} [options.fetchImpl] Fetch implementation for testability.
   */
  constructor({ authUrl = DEFAULT_BACKEND_AUTH_URL, fetchImpl = fetch } = {}) {
    this.authUrl = authUrl;
    this.fetchImpl = fetchImpl;
  }

  /**
   * Send the OAuth code to the backend for exchange.
   *
   * @param {Object} params
   * @param {string} params.code OAuth authorization code from GitHub.
   * @param {string} params.state Random state value used to protect the flow.
   * @param {string} params.redirectUri Redirect URI used in the authorization request.
   * @param {string} params.clientId GitHub OAuth client ID.
    * @param {string} params.codeVerifier PKCE verifier generated for the flow.
   * @returns {Promise<Object>} Backend response payload.
   */
    async exchangeCode({ code, state, redirectUri, clientId, codeVerifier }) {
    if (!code) {
      throw new Error("Missing GitHub OAuth code.");
    }

    let response;
    try {
      response = await this.fetchImpl(this.authUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          code,
          state,
          redirect_uri: redirectUri,
          client_id: clientId,
          code_verifier: codeVerifier,
        }),
      });
    } catch (error) {
      throw new Error(
        `Unable to contact the backend OAuth service: ${error.message}`
      );
    }

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        payload.detail ||
          payload.message ||
          `Backend OAuth exchange failed with status ${response.status}`
      );
    }

    return payload;
  }
}