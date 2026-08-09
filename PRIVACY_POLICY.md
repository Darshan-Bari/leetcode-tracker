# LeetCode Tracker Privacy Policy

Effective date: August 8, 2026

LeetCode Tracker does not use advertising, analytics, telemetry, or data brokers. It processes only the data needed to authenticate, read LeetCode submissions, and sync selected solutions to a GitHub repository.

## Data processed

- **Authentication information:** GitHub OAuth codes and access tokens, OAuth state/PKCE values, and the signed-in LeetCode session cookies needed for authenticated requests.
- **Personally identifying information:** the GitHub account username used to show the connected account.
- **Website activity:** LeetCode solved-problem and submission history, status, language, runtime, and timestamps.
- **Website content:** submitted source code, optional notes, and problem titles/descriptions selected for synchronization.

## Where data goes

- GitHub OAuth authorization occurs on GitHub. The authorization code and PKCE exchange values are sent over HTTPS to the configured LeetCode Tracker OAuth backend, which exchanges them with GitHub.
- GitHub tokens and extension settings are stored in Firefox local extension storage.
- Selected solutions, notes, descriptions, and timestamps are sent to the user-selected repository through `api.github.com`.
- LeetCode data and cookies are used only for authenticated requests to `leetcode.com`; they are not sent to the OAuth backend.

## Retention and control

Logging out clears the GitHub token and extension account configuration from local extension storage. Content committed to GitHub remains in the selected repository until the user removes it through GitHub. Users can revoke the OAuth grant in GitHub settings and remove the extension in Firefox.

## Permissions

The extension uses storage and identity for account configuration, tabs to communicate with an open LeetCode page and complete OAuth fallback, cookies and webRequest permissions to make authenticated LeetCode requests and detect submission results, and host access only for LeetCode, the GitHub API, and the configured OAuth backend.

Questions or deletion requests concerning GitHub or LeetCode data should be handled through those services. Project-specific contact information should be supplied in the AMO listing before publication.
