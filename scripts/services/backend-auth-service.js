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
        `Unable to contact the backend OAuth service: ${error.message}`
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