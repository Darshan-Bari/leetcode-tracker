const banners = {
    submissionAccepted: 'assets/mission_passed_green.mp4',
    submissionRejected: 'assets/wasted_green.mp4'
};

const sounds = {
    missionPassed: 'assets/mission_passed.mp3',
    wasted: 'assets/wasted.mp3'
};

const bannerSounds = {
    submissionAccepted: 'missionPassed',
    submissionRejected: 'wasted'
};

const animations = {
    duration: 800,
    span: 3500, // Total display time
    easings: {
        easeOutQuart: 'cubic-bezier(0.25, 1, 0.5, 1)'
    }
};

const delays = {
    submissionAccepted: 1000,
    submissionRejected: 500
};

// Updated banner dimensions for horizontal layout
const bannerConfig = {
    width: '100%',       // Width of the banner (left to right)
    height: '300px',    // Height of the banner (much shorter)
    opacity: 0.85       // Translucent effect
};

console.log('GTA LeetCode Extension - Content script loaded on:', window.location.href);

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeExtension);
} else {
    initializeExtension();
}

function initializeExtension() {
    console.log('GTA LeetCode Extension initialized, DOM ready');
}

// Intercept fetch to capture submission IDs from LeetCode's own API responses
const _originalFetch = window.fetch;
window.fetch = function(...args) {
    const result = _originalFetch.apply(this, args);
    
    result.then(response => {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        // Capture submission ID from submit mutation responses
        if (url.includes('/graphql') && args[1]?.method === 'POST') {
            response.clone().json().then(data => {
                // Look for submission_id in response data
                const submissionId = data?.data?.submissionCreateSubmit?.submissionId 
                    || data?.data?.submitCode?.submission_id
                    || data?.data?.submit?.submissionId;
                if (submissionId) {
                    console.log('GTA Extension: Captured submission ID from fetch:', submissionId);
                    window.__gtaLastSubmissionId = String(submissionId);
                }
            }).catch(() => {});
        }
    }).catch(() => {});
    
    return result;
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    console.log('Message received in content script:', message);
    
    if (!message?.action) {
        console.log('No action in message');
        sendResponse({ received: false, error: 'No action provided' });
        return false;
    }

    // Handle request for submission ID from background script
    if (message.action === 'getSubmissionId') {
        let submissionId = null;
        
        // 1. Check if we captured it via fetch interception
        if (window.__gtaLastSubmissionId) {
            submissionId = window.__gtaLastSubmissionId;
            window.__gtaLastSubmissionId = null;
        }
        
        // 2. Try extracting from the current page URL
        if (!submissionId) {
            const urlMatch = window.location.href.match(/\/submissions\/(\d+)\/?/);
            if (urlMatch) {
                submissionId = urlMatch[1];
            }
        }
        
        // 3. Try extracting from the DOM (LeetCode often shows submission ID in result views)
        if (!submissionId) {
            const resultLink = document.querySelector('a[href*="/submissions/detail/"]');
            if (resultLink) {
                const linkMatch = resultLink.href.match(/\/submissions\/detail\/(\d+)/);
                if (linkMatch) submissionId = linkMatch[1];
            }
        }

        console.log('GTA Extension: Responding with submissionId:', submissionId);
        sendResponse({ submissionId });
        return false;
    }

    console.log(`Showing GTA banner for action: ${message.action}`);
    try {
        show(message.action);
        sendResponse({ received: true, action: message.action });
    } catch (error) {
        console.error('Error showing GTA banner:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        sendResponse({ received: false, error: errorMessage });
    }
    
    return true;
});

function show(action, delay = delays[action] ?? 1000) {
    console.log(`show() called with action: ${action}, delay: ${delay}`);
    
    if (!banners[action]) {
        console.error(`Invalid action: ${action}`);
        return;
    }

    console.log('Creating GTA horizontal banner...');
    
    // Create container for the banner
    const bannerContainer = document.createElement('div');
    bannerContainer.id = 'gta-banner-container';
    bannerContainer.style.position = 'fixed';
    bannerContainer.style.top = '50%';
    bannerContainer.style.left = '50%';
    bannerContainer.style.transform = 'translate(-50%, -50%)';
    bannerContainer.style.zIndex = '99999';
    bannerContainer.style.width = bannerConfig.width;
    bannerContainer.style.height = bannerConfig.height;
    bannerContainer.style.opacity = '0';
    bannerContainer.style.pointerEvents = 'none';
    bannerContainer.style.borderRadius = '15px';
    bannerContainer.style.overflow = 'hidden';
    bannerContainer.style.boxShadow = '0 0 30px rgba(0, 0, 0, 0.6)';
    bannerContainer.style.backdropFilter = 'blur(5px)';
    bannerContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.3)'; // Added background for better visibility

    // Create the video element
    const video = document.createElement('video');
    const videoSrc = chrome.runtime.getURL(banners[action]);
    console.log('Video source URL:', videoSrc);
    
    video.src = videoSrc;
    video.autoplay = true;
    video.muted = false;
    video.loop = false;
    video.style.width = '100%';
    video.style.height = '100%';
    video.style.objectFit = 'cover';
    video.style.objectPosition = 'center';
    video.style.borderRadius = '15px';
    video.style.opacity = bannerConfig.opacity.toString();

    video.onerror = () => {
        console.error('Failed to load GTA video:', videoSrc);
        showFallbackBanner(action, bannerContainer);
    };

    video.onload = () => {
        console.log('GTA video loaded successfully');
    };

    video.onended = () => {
        console.log('GTA video ended, starting fade out');
        fadeOutBanner(bannerContainer);
    };

    // Add video to container
    bannerContainer.appendChild(video);

    // Play sound separately
    const soundSrc = chrome.runtime.getURL(sounds[bannerSounds[action]]);
    console.log('Sound source URL:', soundSrc);
    
    const audio = new Audio(soundSrc);
    audio.volume = 0.7;

    console.log(`Setting timeout for ${delay}ms before showing GTA banner`);
    
    setTimeout(() => {
        console.log('Showing GTA banner now...');
        
        requestAnimationFrame(() => {
            console.log('Appending banner to body');
            document.body.appendChild(bannerContainer);

            // Fade in animation
            bannerContainer.animate([
                { opacity: 0, transform: 'translate(-50%, -50%) scale(0.9)' },
                { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }
            ], {
                duration: animations.duration,
                easing: animations.easings.easeOutQuart,
                fill: 'forwards'
            });

            // Play audio
            audio.play().catch((error) => {
                console.log('Could not play sound:', error);
            });

            // Auto-remove if video doesn't end naturally (safety)
            setTimeout(() => {
                if (bannerContainer.parentNode) {
                    console.log('Safety removal of banner');
                    fadeOutBanner(bannerContainer);
                }
            }, 5000);
        });
    }, delay);
}

function fadeOutBanner(bannerContainer) {
    bannerContainer.animate([
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        { opacity: 0, transform: 'translate(-50%, -50%) scale(0.9)' }
    ], {
        duration: animations.duration,
        easing: animations.easings.easeOutQuart,
        fill: 'forwards'
    });

    setTimeout(() => {
        if (bannerContainer.parentNode) {
            bannerContainer.remove();
        }
    }, animations.duration);
}

function showFallbackBanner(action, container) {
    // Remove video if it exists
    while (container.firstChild) {
        container.removeChild(container.firstChild);
    }

    const fallback = document.createElement('div');
    fallback.style.width = '100%';
    fallback.style.height = '100%';
    fallback.style.display = 'flex';
    fallback.style.alignItems = 'center';
    fallback.style.justifyContent = 'center';
    fallback.style.fontFamily = 'Arial Black, Impact, sans-serif';
    fallback.style.fontSize = '2.5em';
    fallback.style.fontWeight = 'bold';
    fallback.style.textTransform = 'uppercase';
    fallback.style.letterSpacing = '3px';
    fallback.style.textAlign = 'center';
    fallback.style.borderRadius = '15px';
    fallback.style.background = 'linear-gradient(135deg, rgba(0,0,0,0.7), rgba(0,0,0,0.5))';
    fallback.style.backdropFilter = 'blur(10px)';
    
    if (action === 'submissionAccepted') {
        fallback.textContent = 'MISSION PASSED';
        fallback.style.color = '#4CAF50';
        fallback.style.textShadow = '0 0 20px #4CAF50, 0 0 30px #4CAF50';
        fallback.style.border = '2px solid #4CAF50';
    } else {
        fallback.textContent = 'WASTED';
        fallback.style.color = '#f44336';
        fallback.style.textShadow = '0 0 20px #f44336, 0 0 30px #f44336';
        fallback.style.border = '2px solid #f44336';
    }

    container.appendChild(fallback);
    container.style.opacity = '1';
    
    // Auto-remove fallback
    setTimeout(() => {
        fadeOutBanner(container);
    }, animations.span);
}