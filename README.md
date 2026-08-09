<p align="center">
  <img src="assets/gta-leetcode-banner.png" alt="LeetCode Tracker GTA Banner" width="650" />
</p>

<h1 align="center">🎮 LeetCode Tracker 🚗💥</h1>

<p align="center">
  <b>Level up your algorithm game with iconic GTA V style overlays & seamless GitHub sync!</b>
</p>

<p align="center">
  <a href="#-the-gta-v-overlay-experience"><img src="https://img.shields.io/badge/Theme-GTA%20V%20Style-4CAF50?style=for-the-badge&logo=gamepad&logoColor=white" alt="GTA V Theme" /></a>
  <a href="https://github.com"><img src="https://img.shields.io/badge/Sync-GitHub%20OAuth-181717?style=for-the-badge&logo=github&logoColor=white" alt="GitHub Sync" /></a>
  <a href="https://www.mozilla.org/firefox"><img src="https://img.shields.io/badge/Firefox-Manifest%20V3-FF7139?style=for-the-badge&logo=firefox-browser&logoColor=white" alt="Firefox Extension" /></a>
  <a href="#features"><img src="https://img.shields.io/badge/Status-Active-brightgreen?style=for-the-badge" alt="Status" /></a>
</p>

---

## 🌟 The GTA V Overlay Experience

Transform standard LeetCode problem solving into high-stakes gaming missions! Whenever you submit code, **LeetCode Tracker** triggers real-time, authentic GTA V overlay animations and audio effects directly inside your browser tab:

<table align="center">
  <tr>
    <td align="center" width="50%">
      <h3>🟩 MISSION PASSED</h3>
      <p><b>RESPECT +1000</b></p>
      <p>Triggered automatically on <code>Accepted</code> submissions. Plays the legendary GTA victory theme with green overlays as your solution is committed to GitHub!</p>
    </td>
    <td align="center" width="50%">
      <h3>🟥 WASTED</h3>
      <p><b>MISSION FAILED</b></p>
      <p>Triggered on <code>Wrong Answer</code>, <code>Time Limit Exceeded</code>, or <code>Runtime Error</code> with the iconic GTA dark vignette & sound effect!</p>
    </td>
  </tr>
</table>

---

## Features

- Syncs a solution when LeetCode reports the submission as **Accepted**.
- Links an existing GitHub repository, with an optional subfolder.
- Updates existing solutions or stores timestamped versions by language.
- Bulk-syncs previously solved problems from the signed-in LeetCode account.
- Optionally adds a note to a submission before committing it.
- Displays best-effort GTA-style success and failure overlays.
- Uses GitHub OAuth with PKCE; the client secret remains on the backend.

## How it works

1. Authenticate with GitHub from the extension popup.
2. Link an existing repository and, optionally, a subfolder.
3. Stay signed in to LeetCode and submit a solution.
4. When the result is Accepted, the extension commits the solution through the GitHub Contents API.
5. Use **Sync** in the popup to import older accepted submissions.

The default output is:

```text
<optional-subfolder>/<problem-id>-<ProblemName>/
├── <problem-id>-<ProblemName>.<extension>
└── README.md
```

Multiple-submission mode writes language-specific versions under `version/<language>/`.

## Quick start

### Requirements

- Firefox 140 or newer
- A GitHub account and an existing repository with write access
- A signed-in LeetCode account for submission detection and bulk sync

### Load the extension locally

1. Clone this repository.
2. Open `about:debugging#/runtime/this-firefox` in Firefox.
3. Select **Load Temporary Add-on…**.
4. Choose `manifest.json` from the repository root.
5. Open the popup, authenticate with GitHub, and link your repository.


Temporary add-ons are removed when Firefox closes. Reload the extension after changing source or configuration.

## Development setup (maintainers only)

> **End users do not need to create a GitHub OAuth App.** Users of the published extension should authenticate through its built-in flow and must never place a client secret in extension code. The steps below are only for maintainers running their own OAuth backend or deploying a separate build.

The included FastAPI service only exchanges the GitHub OAuth authorization code. LeetCode requests and GitHub repository operations run directly from the extension.

### 1. Create a GitHub OAuth App for your own build

Load the extension once, open its background-script console from `about:debugging`, and evaluate:

```javascript
browser.identity.getRedirectURL("github")
```

Use the exact returned URL as both:

- the GitHub OAuth App **Authorization callback URL**;
- the backend `GITHUB_REDIRECT_URI` value.

Do not put the GitHub client secret in extension code.

### 2. Run the OAuth backend locally

From the repository root on Windows:

```bat
python -m venv .venv
.venv\Scripts\python -m pip install -r backend\requirements.txt
copy backend\.env.example backend\.env
.venv\Scripts\python -m uvicorn main:app --app-dir backend --reload --port 8000
```

Set these values in `backend/.env` before starting the service:

```dotenv
GITHUB_CLIENT_ID=your_client_id
GITHUB_CLIENT_SECRET=your_client_secret
GITHUB_REDIRECT_URI=the_exact_firefox_redirect_url
```

Verify `http://127.0.0.1:8000/` and `http://127.0.0.1:8000/health`. The health response should contain `"github_configured": true`.

### 3. Configure the extension

Update `environment.js`:

```javascript
const REDIRECT_URL = browser.identity.getRedirectURL("github");

export const ENV = {
  BACKEND_AUTH_URL: "http://127.0.0.1:8000/auth/github",
  AUTH_URL: "https://github.com/login/oauth/authorize",
  REDIRECT_URL,
  CLIENT_ID: "your_client_id",
  SCOPES: ["repo"],
};
```

For a local backend, also add `"http://127.0.0.1:8000/*"` to `host_permissions` in `manifest.json`. For production, use an HTTPS backend URL and add its origin instead.

### Deploy the backend on Render

Create a Python Web Service with:

| Setting | Value |
| --- | --- |
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn main:app --host 0.0.0.0 --port $PORT` |

Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `GITHUB_REDIRECT_URI` in Render, then update `BACKEND_AUTH_URL` and `host_permissions` with the deployed HTTPS origin. More backend details are in [`backend/README.md`](backend/README.md).


## Build and validation

Use the pinned Mozilla `web-ext` release so local and release builds are reproducible:

```bat
npx --yes web-ext@10.6.0 lint
npx --yes web-ext@10.6.0 build --ignore-files "backend" "backend/**" ".vscode" ".vscode/**" "gta-leetcode-extension" "gta-leetcode-extension/**" "web-ext-artifacts" "web-ext-artifacts/**" ".web-ext-artifacts" ".web-ext-artifacts/**" "**/*.zip" "**/*.xpi" "README.md" "AMO_REVIEW_NOTES.md" "replace_chrome.py" "read_pdf.py"
```

The package is written to `web-ext-artifacts/`. `web-ext` 10.6.0 requires the explicit `--ignore-files` arguments above; `.web-ext-ignore` records the same release exclusions but is not automatically consumed by that CLI version. Packaging excludes the backend, local environments, secrets, reference project, IDE files, and old artifacts. This repository currently has no automated test suite; manually test OAuth, repository linking, accepted submissions, rejected submissions, bulk sync, unlink, and logout before publishing.

## Project structure

```text
backend/                 FastAPI OAuth code-exchange service
assets/                  Icons, fonts, audio, and video
css/                     Popup styles and vendored Bootstrap CSS
scripts/                 LeetCode, GitHub, sync, model, and UI services
background.js            Extension controller and message handling
popup.html / popup.js     Popup interface
manifest.json             Firefox permissions and extension metadata
environment.js            Public OAuth and backend configuration
```

## Privacy and security

- The GitHub token, account name, linked repository, settings, and sync status are stored in `browser.storage.local`; logout clears this local data.
- The current OAuth configuration requests GitHub's broad `repo` scope, which can include private repositories.
- Accepted code, optional notes, problem descriptions, and timestamps are committed to the selected GitHub repository. Check the repository's visibility before syncing.
- Bulk sync accesses LeetCode using the active signed-in browser session.
- The extension uses cookies and web-request permissions for authenticated LeetCode requests and the optional GTA-style result overlay.
- No analytics, advertising, or telemetry are implemented.
- Use HTTPS for a production OAuth backend and keep `GITHUB_CLIENT_SECRET` on the backend only.
- See [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) for the complete data disclosure and [`AMO_REVIEW_NOTES.md`](AMO_REVIEW_NOTES.md) for permission justifications.

## Troubleshooting

- **OAuth redirect error:** the GitHub callback URL, backend `GITHUB_REDIRECT_URI`, and `browser.identity.getRedirectURL("github")` output must match exactly.
- **Client ID mismatch:** use the same OAuth App client ID in `environment.js` and the backend.
- **Repository link fails:** confirm the repository already exists and the authenticated account has write access.
- **Bulk sync fails:** sign in to LeetCode, retry later if rate-limited, and inspect the extension background console.
- **Overlay changes do not appear:** reload the temporary extension and refresh the LeetCode tab before testing another submission.

## Contributing

Fork the repository, create a focused branch, run `web-ext lint`, complete the manual checks above, and open a pull request. Never commit OAuth secrets or access tokens.

## License recommendation

This repository currently has **no project-wide license**, so normal copyright restrictions apply by default.

**Recommended:** license the original source code under the **MIT License** after completing an asset audit. MIT is concise, permissive, and compatible with the vendored [Bootstrap MIT license](https://github.com/twbs/bootstrap/blob/main/LICENSE).

Do not apply MIT to every bundled asset without verifying its source and redistribution terms:

- Poppins is commonly distributed under the SIL Open Font License; verify these exact files and include the applicable OFL notice. See the [Poppins source](https://github.com/itfoundry/poppins).
- GitHub marks remain subject to the [GitHub Logo Policy](https://docs.github.com/en/site-policy/other-site-policies/github-logo-policy).
- The GTA-style audio and video files need documented permission or replacement with original/clearly licensed media before redistribution. General fan-content tolerance is not the same as an open-source license.
- Third-party notices should remain separate from the license covering original project code.

A safe licensing layout would be a root `LICENSE` containing MIT for original code plus a `THIRD_PARTY_NOTICES.md` file listing excluded assets and their respective terms. Add those only after confirming ownership and provenance.

## Disclaimer

This is an independent project and is not affiliated with or endorsed by LeetCode, GitHub, Rockstar Games, or Take-Two Interactive. Service APIs and page structure can change and may temporarily break integration.
