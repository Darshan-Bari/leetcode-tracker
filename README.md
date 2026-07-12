<h1 align="center">
  LeetCode Tracker — Automatically sync your LeetCode submissions to GitHub.
  <br>
  <br>
</h1>

<div align="center">
  <p>
    <strong>Available for Firefox</strong>
  </p>
</div>

## What is LeetCode Tracker?

<p>A browser extension that automatically pushes your code to GitHub when you pass all tests on a <a href="http://leetcode.com/problems/">LeetCode problem</a>.</p>

<p><strong>🔥 NEW: GTA Theme Integration!</strong> Celebrate your coding victories (and defeats) with style. The extension now features classic Grand Theft Auto "Mission Passed" and "Wasted" overlays and sound effects whenever you submit your LeetCode solutions!</p>

## Why LeetCode Tracker?

<p> <strong>1.</strong> Recruiters <em>want</em> to see your contributions to the Open Source community, be it through side projects, solving algorithms/data-structures, or contributing to existing OS projects.<br>
As of now, GitHub is developers' #1 portfolio. LeetCode Tracker just makes it much easier (autonomous) to keep track of progress and contributions on the largest network of engineering community, GitHub.</p>

<p> <strong>2.</strong> There's no easy way of accessing your LeetCode problems in one place! <br>
Moreover, pushing code manually to GitHub from LeetCode is very time consuming. So, why not just automate it entirely without spending a SINGLE additional second on it? </p>

## How does LeetCode Tracker work?

<ol>
  <li>After installation, launch LeetCode Tracker.</li>
  <li>Click on "Authenticate" button to automatically link your GitHub account with the extension.</li>
  <li>Set up an existing repository.</li>
  <li>Begin LeetCoding! To view your progress, simply click on the extension!</li>
</ol>

## Why did I build LeetCode Tracker?

<p>
The coding interview is arguably the most important part of your interview process, given you get the interview first. As someone who's received multiple internship offers from Fortune 100 companies, getting the interview in the first place is not easy!<br>
And that's what LeetCode Tracker is supposed to do: indirectly improving your coding skills while improving your portfolio to ACE that interview at big tech companies! <br>
There were many browser extensions to automatically synchronize LeetCode code with GitHub, but none of them was up-to-date to work with the new LeetCode interface.
</p>

# How to set up LeetCode Tracker for local development

## Prerequisites

- Firefox Browser (v109 or later)
- One GitHub OAuth App that you control for this extension
- A backend that can exchange OAuth codes with GitHub

## Extension Setup

<ol>
  <li>Fork this repo and clone it locally.</li>
  <li>Create or update <code>environment.js</code> in the extension root.</li>
  <li>Put your GitHub OAuth App Client ID into <code>CLIENT_ID</code>.</li>
  <li>Do not place the GitHub Client Secret anywhere in the extension.</li>
  <li>Set <code>REDIRECT_URL</code> to <code>browser.identity.getRedirectURL("github")</code>.</li>
</ol>

```javascript
export const ENV = {
  AUTH_URL: "https://github.com/login/oauth/authorize",
  REDIRECT_URL: browser.identity.getRedirectURL("github"),
  CLIENT_ID: "YOUR_CLIENT_ID",
  SCOPES: ["repo"],
};
```

### Backend Setup

<p>The extension sends the GitHub authorization code to the backend instead of exchanging it in the browser. The backend owns the GitHub Client Secret, validates the OAuth request, and exposes <code>POST /auth/github</code>, <code>GET /</code>, and <code>GET /health</code>.</p>

<h3>Local backend setup</h3>

<ol>
  <li>Open the included <code>backend/</code> folder.</li>
  <li>Install dependencies with <code>pip install -r requirements.txt</code>.</li>
  <li>Create <code>backend/.env</code> from <code>backend/.env.example</code>.</li>
  <li>Set <code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code>, and <code>GITHUB_REDIRECT_URI</code> as environment variables.</li>
  <li>Start the backend with <code>uvicorn main:app --reload --port 8000</code>.</li>
</ol>

<h3>Render deployment</h3>

<p>Render works with the FastAPI app in <code>backend/main.py</code> without any architectural changes.</p>

<ol>
  <li>Create a new Render Web Service from this repository.</li>
  <li>Set <strong>Root Directory</strong> to <code>backend</code>.</li>
  <li>Set <strong>Build Command</strong> to <code>pip install -r requirements.txt</code>.</li>
  <li>Set <strong>Start Command</strong> to <code>uvicorn main:app --host 0.0.0.0 --port $PORT</code>.</li>
  <li>Add the required environment variables in the Render dashboard.</li>
  <li>Deploy and verify <code>/</code> and <code>/health</code>.</li>
</ol>

<h3>Environment variables</h3>

<p>The backend reads configuration only from environment variables. Do not hardcode secrets anywhere in the extension or backend source.</p>

<ul>
  <li><code>GITHUB_CLIENT_ID</code>: the GitHub OAuth App client ID.</li>
  <li><code>GITHUB_CLIENT_SECRET</code>: the GitHub OAuth App client secret. Keep this only on the backend.</li>
  <li><code>GITHUB_REDIRECT_URI</code>: the exact redirect URI returned by <code>browser.identity.getRedirectURL("github")</code>.</li>
</ul>

<p>The backend sample file <code>backend/.env.example</code> documents the same variables. Use Render environment variables for production.</p>

<h3>Callback URL</h3>

<p>Configure the GitHub OAuth App callback URL with the exact value returned by <code>browser.identity.getRedirectURL("github")</code>. That value must also be placed into <code>GITHUB_REDIRECT_URI</code> on the backend.</p>

<p>The extension must point <code>BACKEND_AUTH_URL</code> at the deployed Render endpoint in <code>background.js</code>. Keep the path set to <code>/auth/github</code>.</p>

<h3>Deployment verification</h3>

<ol>
  <li>Open <code>https://your-render-service.onrender.com/</code> and confirm the JSON response includes <code>service</code>, <code>version</code>, and <code>status: running</code>.</li>
  <li>Open <code>https://your-render-service.onrender.com/health</code> and confirm <code>status: ok</code> and <code>github_configured: true</code>.</li>
  <li>Start the Firefox extension and test GitHub login.</li>
  <li>Confirm the extension receives an access token and can continue syncing submissions.</li>
</ol>

<h3>OAuth troubleshooting</h3>

<ul>
  <li>If login fails immediately, verify <code>BACKEND_AUTH_URL</code> points to the Render service and not <code>localhost</code>.</li>
  <li>If the backend returns <code>invalid_redirect_uri</code>, check that the GitHub OAuth callback URL exactly matches <code>browser.identity.getRedirectURL("github")</code>.</li>
  <li>If the backend returns <code>client_id_mismatch</code>, confirm the extension client ID and backend environment variable use the same GitHub OAuth App.</li>
  <li>If GitHub returns <code>invalid_oauth_code</code> or <code>expired_oauth_code</code>, restart the login flow and generate a new authorization code.</li>
  <li>If Render reports startup issues, verify the environment variables are present and the start command uses <code>$PORT</code>.</li>
</ul>

### GitHub OAuth callback URL

<p>Configure the GitHub OAuth App callback URL with the exact value returned by <code>browser.identity.getRedirectURL("github")</code>. That value is the only redirect URL the extension uses in production.</p>

<p>For Firefox Add-ons, the callback must be the add-on-owned redirect URL generated by Firefox for your extension, not a localhost URL.</p>

### Loading in Firefox

<ol>
  <li>Open Firefox and navigate to <code>about:debugging#/runtime/this-firefox</code>.</li>
  <li>Click "Load Temporary Add-on..."</li>
  <li>Select the <code>manifest.json</code> file from the LeetCode Tracker folder.</li>
</ol>

### Authentication Flow

<p>Clicking <strong>Authenticate</strong> opens <code>https://github.com/login/oauth/authorize</code>. The extension generates a secure <code>state</code> value, creates a PKCE verifier/challenge pair, validates the redirect, and sends the resulting code plus verifier to <code>POST /auth/github</code> on your backend.</p>

<p><code>browser.identity.launchWebAuthFlow()</code> is the primary authentication mechanism. If it is unavailable, the extension falls back to a secure tab-based OAuth flow that still uses the Firefox redirect URL and never sends users to GitHub developer pages.</p>

### Why the Client Secret must stay on the backend

<p>Browser extensions are distributed client-side code. Anything packaged inside the extension can be inspected or extracted. If the GitHub Client Secret ships in the extension, anyone can impersonate the OAuth App. Keeping the secret only on the backend prevents that exposure.</p>

### Minimal FastAPI backend

<p>If you do not already have a backend, the repository now includes a minimal FastAPI scaffold under <code>backend/</code> that implements <code>POST /auth/github</code>.</p>

<p>It accepts the GitHub OAuth code, exchanges it with GitHub using environment variables, and returns the access token to the extension.</p>

### Deploying the backend

<p>Render is the recommended production host for the backend. The service is designed to run as a standard Python Web Service with no custom build tooling.</p>

<ul>
  <li>Root Directory: <code>backend</code></li>
  <li>Build Command: <code>pip install -r requirements.txt</code></li>
  <li>Start Command: <code>uvicorn main:app --host 0.0.0.0 --port $PORT</code></li>
  <li>Environment Variables: <code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code>, <code>GITHUB_REDIRECT_URI</code></li>
</ul>

### Security best practices

<ul>
  <li>Keep <code>GITHUB_CLIENT_SECRET</code> only in backend environment variables.</li>
  <li>Use HTTPS for the backend in production.</li>
  <li>Rotate the GitHub OAuth App secret if it is ever exposed.</li>
  <li>Keep the extension limited to <code>CLIENT_ID</code>, the redirect URL, and the requested scopes.</li>
  <li>Do not deploy localhost URLs to Render.</li>
  <li>Verify the backend logs never include the client secret, access token, authorization code, or PKCE verifier.</li>
</ul>

### Deployment checklist

<ul>
  <li>✅ Push the repository to GitHub.</li>
  <li>✅ Create a Render Web Service.</li>
  <li>✅ Set Root Directory to <code>backend</code>.</li>
  <li>✅ Set Build Command to <code>pip install -r requirements.txt</code>.</li>
  <li>✅ Set Start Command to <code>uvicorn main:app --host 0.0.0.0 --port $PORT</code>.</li>
  <li>✅ Add <code>GITHUB_CLIENT_ID</code>.</li>
  <li>✅ Add <code>GITHUB_CLIENT_SECRET</code>.</li>
  <li>✅ Add <code>GITHUB_REDIRECT_URI</code>.</li>
  <li>✅ Verify <code>/</code>.</li>
  <li>✅ Verify <code>/health</code>.</li>
  <li>✅ Update <code>BACKEND_AUTH_URL</code> in the extension to the Render URL.</li>
  <li>✅ Test GitHub login in Firefox.</li>
</ul>

### Building for Firefox Add-ons (AMO) Publishing

```bash
# Install web-ext tool globally
npm install -g web-ext

# Validate the extension
web-ext lint

# Build the .zip for submission
web-ext build

# The .zip will be in the web-ext-artifacts/ directory
```

Then upload the generated `.zip` file to [Firefox Add-on Developer Hub](https://addons.mozilla.org/developers/).

## Privacy Policy

LeetCode Tracker stores GitHub tokens, repository configuration, and settings in the browser's local storage (`browser.storage.local`). It does not implement analytics or telemetry.

The extension communicates with:

- **github.com** — For OAuth authorization and repository operations
- **api.github.com** — For creating/updating files in your GitHub repository
- **leetcode.com** — For reading your submission data when you are logged in
- **your backend** — For exchanging the OAuth code for a GitHub access token
