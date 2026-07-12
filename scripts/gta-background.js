// Error silencing for expected extension behaviors
const originalConsoleError = console.error;
console.error = (...args) => {
  // Skip logging common expected errors that don't affect functionality
  if (args[0] && typeof args[0] === 'string' && 
      (args[0].includes('Error sending message') || 
       args[0].includes('Could not establish connection') ||
       args[0].includes('Receiving end does not exist'))) {
    console.log('Extension: Expected temporary connection issue (auto-retrying)');
    return; // Silently ignore these expected errors
  }
  originalConsoleError.apply(console, args);
};

// Also reduce some noisy info logs
const originalConsoleLog = console.log;
console.log = (...args) => {
  // Reduce frequency of some repetitive logs
  if (args[0] && typeof args[0] === 'string' && 
      args[0].includes('Retrying in')) {
    // Only show every few retries to reduce noise
    if (Math.random() < 0.3) { // 30% chance to show retry logs
      originalConsoleLog.apply(console, args);
    }
    return;
  }
  originalConsoleLog.apply(console, args);
};

const pendingSubmissions = new Map();

// Known operation names LeetCode has used for code submission.
// They change these periodically, so we match flexibly.
const SUBMIT_OPERATION_NAMES = [
    'submitCode',
    'submissionCreateSubmit', 
    'submissionCreate',
    'submitSolution',
    'consolePanelSubmit',
];

async function dispatch(action, details) {
    const tabId = details.tabId;
    if (typeof tabId !== 'number' || !tabId) return;

    console.log(`Dispatching GTA action: ${action} to tab: ${tabId}`);
    
    try {
        const tab = await new Promise((resolve) => {
            chrome.tabs.get(tabId, (tab) => {
                if (chrome.runtime.lastError) {
                    console.error('Error getting tab:', chrome.runtime.lastError);
                    resolve(undefined);
                } else {
                    resolve(tab);
                }
            });
        });

        if (!tab || !tab.active) {
            console.log(`Tab ${tabId} is not active or no longer exists`);
            return;
        }

        const sendMessage = (retryCount = 0) => {
            try {
                chrome.tabs.sendMessage(tabId, { action }, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error('Error sending message:', chrome.runtime.lastError);
                        
                        if (retryCount < 2) { 
                            const delay = Math.pow(2, retryCount) * 1000;
                            console.log(`Retrying in ${delay}ms... (attempt ${retryCount + 1}/2)`);
                            setTimeout(() => sendMessage(retryCount + 1), delay);
                        } else {
                            console.error('Max retries reached for tab', tabId);
                            injectContentScript(tabId, action);
                        }
                    } else if (response) {
                        console.log('Received response:', response);
                    }
                });
            } catch (error) {
                console.error('Error in dispatch:', error);
            }
        };
        
        sendMessage(0);
    } catch (error) {
        console.error('Error in dispatch:', error);
    }
}

async function injectContentScript(tabId, action) {
    try {
        await new Promise((resolve, reject) => {
            chrome.scripting.executeScript({
                target: { tabId },
                files: ['scripts/gta-content.js']
            }, () => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve();
                }
            });
        });
        
        await new Promise(resolve => setTimeout(resolve, 500));
        
        chrome.tabs.sendMessage(tabId, { action }, () => {
            if (chrome.runtime.lastError) {
                console.error('Still failed to send message after injection:', chrome.runtime.lastError);
            } else {
                console.log('Message sent successfully after script injection');
            }
        });
    } catch (error) {
        console.error('Error injecting content script:', error);
    }
}

function readBody(detail) {
    if (detail.method !== 'POST') return null;

    if (detail.requestBody?.formData) {
        return detail.requestBody.formData;
    }

    const bytes = detail.requestBody?.raw?.[0]?.bytes;
    if (!bytes) return null;

    const decoder = new TextDecoder('utf-8');
    const jsonStr = decoder.decode(bytes);

    try {
        return JSON.parse(jsonStr);
    } catch {
        return jsonStr;
    }
}

/**
 * Check if a request is a LeetCode GraphQL request with a matching operation.
 * Handles both /graphql and /graphql/ (with trailing slash) endpoints.
 * Also handles batched requests (array of operations).
 */
const matchLeetCodeGraphQL = (detail, operationNames) => {
    // Flexible URL matching: accept /graphql, /graphql/, /graphql?...
    if (!detail.url.match(/https:\/\/leetcode\.com\/graphql\/?(\?.*)?$/)) return false;
    if (detail.method !== 'POST') return false;

    const body = readBody(detail);
    if (!body || typeof body !== 'object') return false;
    
    // Normalize operationNames to an array
    const names = Array.isArray(operationNames) ? operationNames : [operationNames];

    // Handle batched requests (array of operations)
    const bodies = Array.isArray(body) ? body : [body];
    
    for (const b of bodies) {
        // Check operationName field (most common)
        if (b.operationName && names.some(name => b.operationName === name)) {
            console.log(`Matched operation by operationName: ${b.operationName}`);
            return true;
        }
        
        // Check query string content as fallback
        if (b.query) {
            const query = Array.isArray(b.query) ? b.query[0] : b.query;
            if (typeof query === 'string') {
                for (const name of names) {
                    if (query.includes(name)) {
                        console.log(`Matched operation by query content: ${name}`);
                        return true;
                    }
                }
            }
        }
    }

    // Broad fallback: check if any operation name contains "submit" (case-insensitive)
    for (const b of bodies) {
        if (b.operationName && b.operationName.toLowerCase().includes('submit')) {
            console.log(`Matched operation by broad submit pattern: ${b.operationName}`);
            return true;
        }
        if (b.query && typeof b.query === 'string' && 
            b.query.toLowerCase().includes('mutation') && 
            b.query.toLowerCase().includes('submit')) {
            console.log('Matched operation by broad mutation+submit pattern in query');
            return true;
        }
    }

    return false;
};

/**
 * Fetch submission result by polling the check endpoint.
 * Uses the tab's cookies for authentication via the cookie API.
 */
async function fetchSubmissionResult(submissionId, tabId) {
    try {
        const pending = pendingSubmissions.get(tabId);
        
        if (!pending || pending.hasDispatched) {
            console.log('Submission already processed or invalid tab ID');
            return;
        }

        const url = `https://leetcode.com/submissions/detail/${submissionId}/check/`;
        console.log(`Polling submission result from: ${url}`);
        
        // Get cookies from the tab's session for authentication
        let cookieHeader = '';
        try {
            const cookies = await chrome.cookies.getAll({ domain: 'leetcode.com' });
            cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        } catch (e) {
            console.log('Could not get cookies via cookies API, falling back to credentials: include');
        }
        
        const fetchOptions = {
            credentials: 'include',
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
            },
        };
        
        // Add cookie header if we got cookies
        if (cookieHeader) {
            fetchOptions.headers['Cookie'] = cookieHeader;
        }
        
        const response = await fetch(url, fetchOptions);
        
        if (!response.ok) {
            console.error(`Failed to fetch submission result: ${response.status}`);
            console.log('Error on check endpoint, trying GraphQL approach...');
            await fetchSubmissionResultViaGraphQL(submissionId, tabId);
            return;
        }
        
        const data = await response.json();
        console.log('Submission result data:', data);
        
        const status = data.state; 
        const statusDisplay = data.status_display || '';
        const statusCode = data.status_code || 0;
        
        let action = null;
        
        if (status === 'SUCCESS' && (statusCode === 10 || statusDisplay === 'Accepted')) {
            action = 'submissionAccepted';
        } else if (status === 'SUCCESS' || status === 'FAILURE' || (statusCode !== 0 && statusCode !== 10)) {
            action = 'submissionRejected';
        } else {
            console.log('Submission still pending, state:', status, 'display:', statusDisplay);
            
            if (pending) {
                const retryCount = (pending.retryCount || 0) + 1;
                if (retryCount < 15) { 
                    pending.retryCount = retryCount;
                    pendingSubmissions.set(tabId, pending);
                    
                    const delay = Math.min(retryCount * 1000, 5000); 
                    setTimeout(() => fetchSubmissionResult(submissionId, tabId), delay);
                } else {
                    console.log('Max retries reached for submission check.');
                    pendingSubmissions.delete(tabId);
                }
            }
            return; 
        }

        if (action && !pending.hasDispatched) {
            console.log(`Determined final GTA action: ${action} for state: ${status}`);
            pending.hasDispatched = true;
            pendingSubmissions.set(tabId, pending);
            dispatch(action, { url: '', method: 'POST', tabId });
            setTimeout(() => pendingSubmissions.delete(tabId), 10000);  
        }
        
    } catch (error) {
        console.error('Error fetching submission result:', error);
        const pending = pendingSubmissions.get(tabId);
        if (pending) {
            const retryCount = (pending.retryCount || 0) + 1;
            if (retryCount < 3) {
                 pending.retryCount = retryCount;
                 pendingSubmissions.set(tabId, pending);
                 setTimeout(() => fetchSubmissionResult(submissionId, tabId), 3000);
            } else {
                 pendingSubmissions.delete(tabId);
            }
        }
    }
}

/**
 * Fallback: fetch submission result via GraphQL endpoint.
 * Used when the REST check endpoint fails with auth errors.
 */
async function fetchSubmissionResultViaGraphQL(submissionId, tabId) {
    try {
        const pending = pendingSubmissions.get(tabId);
        if (!pending || pending.hasDispatched) return;

        let cookieHeader = '';
        let csrfToken = '';
        try {
            const cookies = await chrome.cookies.getAll({ domain: 'leetcode.com' });
            cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');
            const csrfCookie = cookies.find(c => c.name === 'csrftoken');
            if (csrfCookie) csrfToken = csrfCookie.value;
        } catch (e) {
            console.log('Could not get cookies for GraphQL fallback');
        }

        const query = `
            query submissionDetails($submissionId: Int!) {
                submissionDetails(submissionId: $submissionId) {
                    statusCode
                    runtimeError
                    compileError
                    lastTestcase
                    totalCorrect
                    totalTestcases
                }
            }
        `;

        const headers = {
            'Content-Type': 'application/json',
            'Referer': 'https://leetcode.com',
        };
        if (cookieHeader) headers['Cookie'] = cookieHeader;
        if (csrfToken) headers['x-csrftoken'] = csrfToken;

        const response = await fetch('https://leetcode.com/graphql/', {
            method: 'POST',
            credentials: 'include',
            headers,
            body: JSON.stringify({
                query,
                variables: { submissionId: parseInt(submissionId) },
                operationName: 'submissionDetails',
            }),
        });

        if (!response.ok) {
            console.error('GraphQL fallback failed:', response.status);
            return;
        }

        const data = await response.json();
        console.log('GraphQL submission result:', data);
        
        const details = data?.data?.submissionDetails;
        if (!details || details.statusCode === 0 || details.statusCode === null) {
            // Still pending, retry
            const retryCount = (pending.retryCount || 0) + 1;
            if (retryCount < 15) {
                pending.retryCount = retryCount;
                pendingSubmissions.set(tabId, pending);
                setTimeout(() => fetchSubmissionResultViaGraphQL(submissionId, tabId), Math.min(retryCount * 1000, 5000));
            }
            return;
        }

        let action = null;
        if (details.statusCode === 10) {
            action = 'submissionAccepted';
        } else if (details.statusCode !== undefined) {
            action = 'submissionRejected';
        }

        if (action && !pending.hasDispatched) {
            console.log(`GraphQL fallback determined GTA action: ${action}`);
            pending.hasDispatched = true;
            pendingSubmissions.set(tabId, pending);
            dispatch(action, { url: '', method: 'POST', tabId });
            setTimeout(() => pendingSubmissions.delete(tabId), 10000);
        }
    } catch (error) {
        console.error('Error in GraphQL fallback:', error);
    }
}

function extractSubmissionId(url) {
    const match = url.match(/\/submissions\/detail\/(\d+)\/check\/?/);
    return match ? match[1] : null;
}

/**
 * Extract submission ID from a GraphQL response body.
 * LeetCode returns the submission_id in the response to the submit mutation.
 */
function extractSubmissionIdFromUrl(url) {
    // Match REST-style submit endpoints: /problems/{slug}/submit/
    const match = url.match(/\/problems\/[^/]+\/submit\/?/);
    return match !== null;
}

// ============================================================
// PRIMARY DETECTION: Intercept GraphQL submission requests
// ============================================================
chrome.webRequest.onBeforeRequest.addListener(
    (detail) => {
        if (pendingSubmissions.has(detail.tabId)) {
            return;
        }

        if (detail.method === 'POST' && detail.requestBody) {
            try {
                const decoder = new TextDecoder('utf-8');
                const rawBytes = detail.requestBody.raw?.[0]?.bytes;
                if (rawBytes) {
                    const body = decoder.decode(rawBytes);
                    console.log('GraphQL request body:', body);
                }
            } catch (e) {
                // Ignore decode errors
            }
            
            // Check for GraphQL submit operations (supports multiple operation names)
            if (matchLeetCodeGraphQL(detail, SUBMIT_OPERATION_NAMES)) {
                console.log('LeetCode submission detected via GraphQL!');
                pendingSubmissions.set(detail.tabId, { 
                    timestamp: Date.now(), 
                    retryCount: 0,
                    hasDispatched: false 
                });
                return;
            }
        }
        
        // Fallback: Detect REST-style submission URLs
        // Matches /problems/{slug}/submit/ (some LeetCode versions use this)
        if (detail.url.includes('leetcode.com') && detail.method === 'POST' && 
            extractSubmissionIdFromUrl(detail.url) && !detail.url.includes('/check')) {
            console.log('Direct submission URL detected:', detail.url);
            pendingSubmissions.set(detail.tabId, { 
                timestamp: Date.now(), 
                retryCount: 0, 
                hasDispatched: false 
            });
            return;
        }

        // Fallback: Broad URL-based detection for any submit-like POST
        if (detail.url.includes('leetcode.com') && detail.url.includes('submit') && 
            detail.method === 'POST' && !detail.url.includes('/check')) {
            console.log('Broad submit URL pattern detected:', detail.url);
            pendingSubmissions.set(detail.tabId, { 
                timestamp: Date.now(), 
                retryCount: 0, 
                hasDispatched: false 
            });
            return;
        }
    },
    { urls: ['*://leetcode.com/*', '*://*.leetcode.com/*'] },
    ['requestBody']
);

// ============================================================
// RESPONSE INTERCEPTION: Catch submission ID from responses
// ============================================================
chrome.webRequest.onCompleted.addListener(
    (detail) => {
        // Detect the check/poll endpoint being called by LeetCode's own frontend
        if (detail.url.includes('leetcode.com/submissions/detail/') && detail.url.includes('/check')) {
            const submissionId = extractSubmissionId(detail.url);
            if (submissionId && pendingSubmissions.has(detail.tabId)) {
                const pending = pendingSubmissions.get(detail.tabId);
                
                if (pending && !pending.hasDispatched && (!pending.submissionId || pending.submissionId === submissionId)) {
                    console.log(`Processing submission check for ID: ${submissionId}`);
                    pending.submissionId = submissionId;
                    pendingSubmissions.set(detail.tabId, pending);
                    
                    setTimeout(() => {
                        fetchSubmissionResult(submissionId, detail.tabId);
                    }, 1000);
                } else if (pending?.hasDispatched) {
                    console.log('Skipping already processed submission');
                }
            }
        }

        // Also detect GraphQL responses that might contain submission IDs
        // This catches cases where the check endpoint URL has changed
        if (detail.url.match(/leetcode\.com\/graphql\/?/) && pendingSubmissions.has(detail.tabId)) {
            const pending = pendingSubmissions.get(detail.tabId);
            if (pending && !pending.submissionId && !pending.hasDispatched) {
                // We have a pending submission but haven't found the submission ID yet.
                // The GraphQL response to the submit mutation should contain it.
                // Since we can't read response bodies in webRequest.onCompleted,
                // we'll wait a bit and then use the content script to extract the ID.
                if (!pending.graphqlResponseWaiting) {
                    pending.graphqlResponseWaiting = true;
                    pendingSubmissions.set(detail.tabId, pending);
                    
                    // Use content script to monitor for submission result 
                    setTimeout(() => {
                        tryExtractSubmissionFromPage(detail.tabId);
                    }, 2000);
                }
            }
        }
    },
    { urls: ['*://leetcode.com/*', '*://*.leetcode.com/*'] },
    ['responseHeaders']
);

/**
 * Try to extract the submission ID from the page by asking the content script
 * to look at the DOM/URL for submission results.
 */
async function tryExtractSubmissionFromPage(tabId) {
    const pending = pendingSubmissions.get(tabId);
    if (!pending || pending.hasDispatched || pending.submissionId) return;

    try {
        // Ask the content script to look for submission ID in the page
        chrome.tabs.sendMessage(tabId, { action: 'getSubmissionId' }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('Could not ask content script for submission ID:', chrome.runtime.lastError.message);
                // Fallback: try to get the URL and extract submission ID
                chrome.tabs.get(tabId, (tab) => {
                    if (chrome.runtime.lastError || !tab) return;
                    const urlMatch = tab.url?.match(/\/submissions\/(\d+)\/?/);
                    if (urlMatch) {
                        const submissionId = urlMatch[1];
                        console.log(`Found submission ID from tab URL: ${submissionId}`);
                        pending.submissionId = submissionId;
                        pendingSubmissions.set(tabId, pending);
                        fetchSubmissionResult(submissionId, tabId);
                    }
                });
                return;
            }
            if (response?.submissionId) {
                console.log(`Got submission ID from content script: ${response.submissionId}`);
                pending.submissionId = response.submissionId;
                pendingSubmissions.set(tabId, pending);
                fetchSubmissionResult(response.submissionId, tabId);
            }
        });
    } catch (error) {
        console.error('Error trying to extract submission from page:', error);
    }
}

// Cleanup stale pending submissions
setInterval(() => {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    for (const [tabId, submission] of pendingSubmissions.entries()) {
        if (submission.timestamp < fiveMinutesAgo) {
            pendingSubmissions.delete(tabId);
        }
    }
}, 60000);