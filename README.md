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
- A GitHub OAuth application (for authentication)

## Setup Steps

<ol>
  <li>Fork this repo and clone to your local machine</li>
  <li>Create a new file <code>environment.js</code> in the cloned folder</li>
  <li>Copy/paste the following code in the new file and replace <code>CLIENT_SECRET</code> and <code>CLIENT_ID</code> with your keys:</li>
</ol>

```javascript
export const ENV = {
  URL: "https://github.com/login/oauth/authorize",
  ACCESS_TOKEN_URL: "https://github.com/login/oauth/access_token",
  REDIRECT_URL: "https://github.com/",
  REPOSITORY_URL: "https://api.github.com/repos/",
  USER_INFO_URL: "https://api.github.com/user",
  CLIENT_SECRET: "YOUR_CLIENT_SECRET_KEY",
  CLIENT_ID: "YOUR_CLIENT_ID",
  SCOPES: ["repo"],
  HEADER: {
    Accept: "application/json",
    "Content-Type": "application/json",
  },
};
```

### Loading in Firefox

<ol>
  <li>Open Firefox and navigate to <code>about:debugging#/runtime/this-firefox</code></li>
  <li>Click "Load Temporary Add-on..."</li>
  <li>Select the <code>manifest.json</code> file from the LeetCode Tracker folder</li>
</ol>

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

LeetCode Tracker does **not** collect, store, or transmit any personal data to external servers. All user data (GitHub tokens, repository configuration, and settings) is stored exclusively in the browser's local storage (`browser.storage.local`) and is never shared with third parties. The extension only communicates with:

- **github.com** — For OAuth authentication and repository operations
- **api.github.com** — For creating/updating files in your GitHub repository
- **leetcode.com** — For reading your submission data (only when you are logged in)

No analytics, telemetry, or tracking of any kind is implemented.
