# AMO Reviewer Notes

LeetCode Tracker synchronizes a user's accepted LeetCode submissions to a repository selected by that user.

- `storage`: stores the OAuth token, GitHub username, linked repository, settings, and sync state locally.
- `identity`: runs GitHub OAuth with PKCE and obtains the Firefox redirect URL.
- `tabs`: finds an open LeetCode tab for same-origin API requests, sends result messages, and supports an OAuth tab fallback.
- `cookies`: reads LeetCode authentication and CSRF cookies for authenticated requests to LeetCode only.
- `webRequest` and `webRequestBlocking`: detect submission requests/results and attach required LeetCode Referer, Cookie, and CSRF headers to extension-originated LeetCode requests.
- LeetCode host access: submission detection and bulk synchronization.
- GitHub API host access: repository listing and user-authorized file commits.
- OAuth backend host access: health check and GitHub authorization-code exchange; the client secret remains server-side.

The LeetCode content script injects a small static, packaged fetch/XMLHttpRequest wrapper into the page's main world because isolated content scripts cannot observe the submission ID returned to page JavaScript. It reads only LeetCode submit responses, extracts a numeric submission ID, and sends that ID through a per-page tokenized bridge to the isolated content script. DOM observations never render an overlay; they can only request an authoritative status recheck. MISSION PASSED or WASTED is rendered only after the background verifies a final status for that submission ID. No remote code is loaded or executed.

The `proxyFetch` message receiver accepts only `GET https://leetcode.com/api/problems/all/` and `POST https://leetcode.com/graphql[/]`, forces credentials, and rejects other origins, paths, and methods.

The manifest declares authentication information, personally identifying information, website activity, and website content because the extension handles tokens/account names and transfers user-selected LeetCode solutions and notes to GitHub.

`web-ext lint` reports the packaged dynamic import in `scripts/loader.js`. Firefox content scripts cannot be declared as JavaScript modules, so this fixed local URL loads `scripts/leetcode.js` as a module. The URL is produced by `runtime.getURL`, all imported files are bundled with the extension, and no remote or variable-controlled code is imported.

For automatic synchronization, the background verifies the final LeetCode status and, for accepted submissions only, requests the accepted submission's code, language, question ID, and title slug from LeetCode's authenticated GraphQL endpoint. That packaged data is delivered to the existing LeetCode content module, which commits it to the user-selected GitHub repository. Rejected submissions never enter the GitHub synchronization path.
