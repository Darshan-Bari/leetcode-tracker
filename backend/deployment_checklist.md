# Deployment Checklist

✅ Push code to GitHub repository
✅ Create a new Render Web Service from the dashboard
✅ Set `Root Directory` to `backend`
✅ Set `Build Command` to `pip install -r requirements.txt`
✅ Set `Start Command` to `uvicorn main:app --host 0.0.0.0 --port $PORT`
✅ Obtain GitHub OAuth Client ID and Secret from GitHub Developer Settings
✅ Retrieve the exact redirect URI using `console.log(browser.identity.getRedirectURL("github"))` in the Firefox extension
✅ Add `GITHUB_CLIENT_ID` to Render Environment Variables
✅ Add `GITHUB_CLIENT_SECRET` to Render Environment Variables
✅ Add `GITHUB_REDIRECT_URI` to Render Environment Variables
✅ Ensure the OAuth app in GitHub has the Authorization callback URL matching the `GITHUB_REDIRECT_URI`
✅ Click "Deploy" on Render and wait for the "Deploy Live" status
✅ Verify root endpoint by opening the deployed URL (e.g., `https://<your-app-name>.onrender.com/`) and ensure it returns status "running"
✅ Verify health endpoint at `https://<your-app-name>.onrender.com/health` and ensure `github_configured` is `true`
✅ Open the extension code (`background.js` or `environment.js`) and update `BACKEND_AUTH_URL` to point to `https://<your-app-name>.onrender.com/auth/github`
✅ Reload the extension in Firefox
✅ Test GitHub Login flow end-to-end via the extension popup
