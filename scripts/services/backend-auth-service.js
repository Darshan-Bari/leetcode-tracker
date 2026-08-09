/**
 * Handles the backend-side OAuth exchange.
 * The extension sends the GitHub authorization code here; the backend owns the
 * client secret and exchanges the code for a GitHub access token.
 */
export default class BackendAuthService {
  /**
   * @param {Object} [options]
   * @param {string} options.authUrl Backend endpoint used to exchange the code.
   */
  constructor({ authUrl }) {
    if (!authUrl) {
      throw new Error("Missing authUrl in BackendAuthService.");
    }
    this.authUrl = authUrl;
    this.healthUrl = new URL("/health", authUrl).toString();
  }

  /**
   * Verify the OAuth backend is reachable and configured before opening GitHub.
   * This also wakes sleeping deployments before the one-time code is issued.
   */
  async ensureAvailable() {
    let response;
    try {
      response = await fetch(this.healthUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
    } catch (error) {
      throw new Error(
        "The OAuth service is unreachable. Check your connection, wait a few seconds, and try again."
      );
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(`The OAuth service health check failed (${response.status}).`);
    }
    if (payload.github_configured === false) {
      throw new Error("The OAuth service is missing its GitHub configuration.");
    }
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

    console.debug("[OAuth] Before backend request");
    console.debug("[OAuth] Backend URL:", this.authUrl);

    let response;
    try {
      response = await fetch(this.authUrl, {
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
      console.debug("[OAuth] Network error:", error.message);
      throw new Error(
        "The OAuth service connection was interrupted. Wait a few seconds and try GitHub authentication again."
      );
    }

    const payload = await response.json().catch(() => ({}));

    console.debug("[OAuth] Response status:", response.status);
    
    const safePayload = { ...payload };
    delete safePayload.access_token;
    delete safePayload.accessToken;
    delete safePayload.token;
    delete safePayload.refresh_token;
    console.debug("[OAuth] Response body:", safePayload);

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