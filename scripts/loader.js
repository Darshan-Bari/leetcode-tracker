/* eslint-disable no-unsanitized/method */
(async () => {
  try {
    if (window.location.host.includes("leetcode.com")) {
      const mainModule = await import(
        browser.runtime.getURL("scripts/leetcode.js")
      );

      // Initialize LeetcodeTracker
      new mainModule.default();
    }
  } catch (error) {
    console.error("Error loading LeetCode Tracker modules:", error);
  }
})();
