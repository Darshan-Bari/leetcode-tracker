/**
 * OAuth callback handler for GitHub authentication.
 * Runs as a content script on github.com pages.
 *
 * In Firefox, content script fetch() is subject to the page's CORS policy,
 * so we delegate the token exchange to the background script which has
 * full cross-origin access via extension permissions.
 */

if (window.location.host === "github.com") {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get("code");

  // Only proceed if this is an OAuth callback with a code parameter
  if (code) {
    browser.runtime
      .sendMessage({
        type: "exchangeOAuthCode",
        code: code,
      })
      .then((response) => {
        if (response && response.success) {
          // Token saved successfully — close this tab or show confirmation
          window.close();
        }
      })
      .catch((error) => {
        console.error("LeetCode Tracker: OAuth exchange failed", error);
      });
  }
}
