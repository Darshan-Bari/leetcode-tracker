/**
 * GitHub OAuth configuration for LeetCode Tracker.
 *
 * This file intentionally contains no client secret. The redirect URL is the
 * Firefox extension-owned redirect target used by OAuth flows.
 */
const REDIRECT_URL = browser.identity.getRedirectURL("github");

export const ENV = {
  BACKEND_AUTH_URL: "https://leetcode-tracker-api-0qkb.onrender.com/auth/github",
  AUTH_URL: "https://github.com/login/oauth/authorize",
  REDIRECT_URL,
  CLIENT_ID: "Ov23li2373AdMZ6EsTwa",
  SCOPES: ["repo"],
};
