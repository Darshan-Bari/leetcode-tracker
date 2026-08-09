/* eslint-disable no-unsanitized/method */
const extensionApi = typeof chrome !== "undefined"
  ? chrome
  : (typeof browser !== "undefined" ? browser : null);

(async () => {
  try {
    if (window.location.host.includes("leetcode.com") && extensionApi?.runtime) {
      const mainModule = await import(
        extensionApi.runtime.getURL("scripts/leetcode.js")
      );

      // Initialize LeetcodeTracker
      new mainModule.default();
    }
  } catch (error) {
    console.error("Error loading LeetCode Tracker modules:", error);
  }
})();
