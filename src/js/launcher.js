// This script runs immediately in launcher.html

// Define stubs to avoid ReferenceErrors until Cast helpers load
var isCasting = function() {
  return window.castHelpers && typeof window.castHelpers.isCasting === 'function'
    ? window.castHelpers.isCasting()
    : false;
};
var maybeClose = function(delay) {
  if (delay) setTimeout(() => {}, delay);
};

console.log("Launcher script started.");

const recordTabButton = document.getElementById('start-capture-btn');
const stopCaptureButton = document.getElementById('stop-capture-btn');
const previewToggleButton = document.getElementById('adentify-preview-toggle-btn');
const predictionDisplay = document.getElementById('adentify-prediction');
let selectedTabId = null;

// Define UI states and central state management
const UIState = {
  START: 'start',
  CAPTURING: 'capturing',
  CAPTURING_OTHER: 'capturing-other-tab'
};
let currentState = UIState.START;

function setState(state, targetTabId) {
  currentState = state;
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const currentTabId = tabs[0]?.id;
    updateUI(state, currentTabId, targetTabId);
  });
}

function updateUI(state, currentTabId, targetTabId) {
  const ui = document.getElementById('adentify-ui');
  switch (state) {
    case UIState.START:
      if (recordTabButton) {
        recordTabButton.textContent = 'Start Adentifying';
        recordTabButton.disabled = false;
        recordTabButton.style.display = 'block';
        recordTabButton.onclick = () => {
          const tabToCapture = selectedTabId || currentTabId;
          chrome.runtime.sendMessage({ type: 'request-start-tab-capture', tabId: tabToCapture });
          setState(UIState.CAPTURING);
        };
      }
      if (stopCaptureButton) stopCaptureButton.style.display = 'none';
      if (ui) {
        ui.classList.add('hidden');
        ui.classList.remove('recording-active');
      }
      break;
    case UIState.CAPTURING:
      if (recordTabButton) recordTabButton.style.display = 'none';
      if (stopCaptureButton) {
        stopCaptureButton.textContent = 'Stop Adentifying';
        stopCaptureButton.disabled = false;
        stopCaptureButton.style.display = 'block';
        stopCaptureButton.onclick = () => {
          updateStatus('Stopping capture...');
          chrome.runtime.sendMessage({ type: 'request-stop-capture' });
          setState(UIState.START);
          maybeClose(500);
        };
      }
      if (ui) {
        ui.classList.remove('hidden');
        ui.classList.add('recording-active');
      }
      break;
    case UIState.CAPTURING_OTHER:
      if (recordTabButton) {
        recordTabButton.textContent = 'Start Adentifying here';
        recordTabButton.disabled = false;
        recordTabButton.style.display = 'block';
        recordTabButton.onclick = () => {
          const tabToCapture = selectedTabId || currentTabId;
          chrome.runtime.sendMessage({ type: 'request-switch-tab-capture', tabId: tabToCapture });
          setState(UIState.CAPTURING);
        };
      }
      if (stopCaptureButton) {
        stopCaptureButton.textContent = 'Stop Adentifying';
        stopCaptureButton.disabled = false;
        stopCaptureButton.style.display = 'block';
        stopCaptureButton.onclick = () => {
          updateStatus('Stopping capture...');
          chrome.runtime.sendMessage({ type: 'request-stop-capture' });
          setState(UIState.START);
          maybeClose(500);
        };
      }
      if (ui) {
        ui.classList.remove('hidden');
        ui.classList.add('recording-active');
      }
      break;
  }
}

// Update status function
function updateStatus(message) {
    // no-op: status messages removed
    console.log("Launcher status:", message);
}

// --- Event Listeners for Buttons ---

// Removed desktop capture option entirely

// Preview Toggle Button
if (previewToggleButton) {
    previewToggleButton.addEventListener('click', () => {
        const ui = document.getElementById('adentify-ui');
        if (ui) {
            ui.classList.toggle('preview-hidden');
            previewToggleButton.textContent = ui.classList.contains('preview-hidden') ? 'Show Preview' : 'Hide Preview';
        }
    });
}

// --- Helper for Handling Background Response & Closing Window ---

function handleBackgroundResponse(response, successMessage) {
    if (chrome.runtime.lastError) {
        updateStatus(`Error communicating with background: ${chrome.runtime.lastError.message}`);
        console.error("Error sending message:", chrome.runtime.lastError.message);
        // Optionally re-enable buttons on error? Depends on desired UX.
        // recordDesktopButton.disabled = false;
        // recordTabButton.disabled = false;
    } else if (response && response.success) {
        updateStatus(successMessage + " Closing...");
        console.log(successMessage, "Response:", response);
        // Close the launcher window after a short delay only if not casting
        maybeClose(500);
    } else {
        // Background script indicated failure or unexpected response
        const errorMessage = response?.error || "Background script failed to process request.";
        updateStatus(`Error: ${errorMessage}`);
        console.warn("Background script response indicates failure:", response);
        // Re-enable buttons if process failed early
        if (recordTabButton) recordTabButton.disabled = false;
    }
}

// --- Listener to Close Window if Requested by Background ---

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'close-launcher') {
        console.log('Received close request from background.');
        updateStatus("Closing launcher...");
        maybeClose();
        sendResponse({status: 'closing'});
        return true; // Indicates async response, though we close immediately
    }
});

// Combined listener for preview frames and predictions
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Handle preview frame
    if (message.type === 'preview-frame' && message.payload?.frameDataUrl) {
        const canvas = document.getElementById('adentify-preview-canvas');
        if (canvas) {
            const ctx = canvas.getContext('2d');
            const img = new Image();
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            };
            img.src = message.payload.frameDataUrl;
        }
        sendResponse({ status: 'preview-received' });
        return true;
    }
    // Handle prediction update
    if (message.type === 'onnxPrediction' && message.payload?.prediction) {
        // Determine display text
        const pred = message.payload.prediction;
        const text = pred === 'Basketball Detected' ? 'Basketball' : 'No Basketball';
        // Update overlay-styled element if present
        if (predictionDisplay) {
            predictionDisplay.textContent = text;
            if (text === 'Basketball') {
                predictionDisplay.classList.add('prediction-basketball');
            } else {
                predictionDisplay.classList.remove('prediction-basketball');
            }
        }
        // Always update the launcher-specific prediction paragraph
        const launchPred = document.getElementById('launcher-prediction');
        if (launchPred) {
            launchPred.textContent = `Prediction: ${text}`;
        }
        // track whether we're in Basketball mode
        isBasketballMode = (text === 'Basketball');
        // Adjust cast volume based on prediction only when casting
        if (typeof isCasting === 'function' && isCasting()) {
            if (text === 'Basketball') {
                setCastVolume(baselineVolume);
            } else {
                setCastVolume(baselineVolume * REDUCED_VOLUME_FACTOR);
            }
        }
        sendResponse({ status: 'prediction-updated' });
        return false;
    }
    if (message.type === 'capture-state-active') {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTabId = tabs[0]?.id;
            const targetTabId = message.targetTabId;
            if (currentTabId === targetTabId) {
                setState(UIState.CAPTURING);
            } else {
                setState(UIState.CAPTURING_OTHER, targetTabId);
            }
            sendResponse({ status: 'ui-updated-active' });
        });
        return true;
    }
    if (message.type === 'capture-state-inactive') {
        setState(UIState.START);
        sendResponse({ status: 'ui-updated-inactive' });
        return false;
    }
    // Let other listeners handle other message types (e.g., close-launcher)
});

// --- Initial State ---

document.addEventListener('DOMContentLoaded', () => {
    chrome.runtime.sendMessage({ type: 'request-capture-state' }, (resp) => {
        if (chrome.runtime.lastError || !resp?.success) return;
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTabId = tabs[0]?.id;
            if (!resp.isActive) {
                setState(UIState.START);
            } else if (resp.targetTabId === currentTabId) {
                setState(UIState.CAPTURING);
            } else {
                setState(UIState.CAPTURING_OTHER, resp.targetTabId);
            }
        });
    });
    chrome.runtime.sendMessage({ type: 'request-last-prediction' }, (r) => {
        if (!chrome.runtime.lastError && r?.success && r.prediction) {
            const txt = r.prediction === 'Basketball Detected' ? 'Basketball' : 'No Basketball';
            const lp = document.getElementById('launcher-prediction');
            if (lp) lp.textContent = `Prediction: ${txt}`;
        }
    });
    // Settings drawer open/close toggle
    const settingsBtn = document.getElementById('settings-btn');
    const settingsDrawer = document.getElementById('settings-drawer');
    if (settingsBtn && settingsDrawer) {
        settingsBtn.addEventListener('click', () => {
            const open = settingsBtn.classList.toggle('open');
            if (open) {
                settingsDrawer.classList.remove('hidden');
                document.body.classList.add('settings-open');
            } else {
                settingsDrawer.classList.add('hidden');
                document.body.classList.remove('settings-open');
            }
        });
        // Close button inside drawer header
        const settingsCloseBtn = document.getElementById('settings-close-btn');
        if (settingsCloseBtn) {
            settingsCloseBtn.addEventListener('click', () => {
                settingsBtn.classList.remove('open');
                settingsDrawer.classList.add('hidden');
                document.body.classList.remove('settings-open');
            });
        }
        // Clicking outside the drawer closes it
        document.addEventListener('click', (e) => {
            if (!settingsBtn.classList.contains('open')) return;
            const target = e.target;
            if (settingsDrawer.contains(target) || settingsBtn.contains(target)) return;
            // Click outside drawer and button
            settingsBtn.classList.remove('open');
            settingsDrawer.classList.add('hidden');
            document.body.classList.remove('settings-open');
        });
    }
    // Adaptive sound toggle: inform background of initial state and listen for changes
    const adaptiveToggle = document.getElementById('adaptive-sound-toggle');
    if (adaptiveToggle) {
        // Send default state to background
        chrome.runtime.sendMessage({ type: 'set-adaptive-sound', enabled: adaptiveToggle.checked });
        adaptiveToggle.addEventListener('change', () => {
            chrome.runtime.sendMessage({ type: 'set-adaptive-sound', enabled: adaptiveToggle.checked });
        });
    }
    // Populate tab selector with all open tabs and listen for selection changes
    const tabSelector = document.getElementById('tab-selector');
    if (tabSelector) {
        // Query all open tabs in Chrome
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(tab => {
                const option = document.createElement('option');
                option.value = tab.id;
                option.textContent = tab.title || tab.url;
                tabSelector.appendChild(option);
            });
            // Set default to the currently active tab in this window
            chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
                if (activeTabs[0]) {
                    tabSelector.value = activeTabs[0].id;
                    selectedTabId = activeTabs[0].id;
                }
            });
        });
        tabSelector.addEventListener('change', () => {
            selectedTabId = parseInt(tabSelector.value, 10);
            console.log('Selected tab ID:', selectedTabId);
        });
    }
});

console.log("Launcher script loaded and listeners attached.");

// Dynamically load Cast support scripts to comply with CSP (no inline event handlers)
const _castScripts = ['cast/cast_helpers.js', 'cast/cast_framework.js'];
_castScripts.reduce((p, src) => p.then(() => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = () => { console.log(`${src} loaded successfully`); res(); };
  s.onerror = (e) => { console.error(`Failed to load ${src}`, e); rej(e); };
  document.head.appendChild(s);
})), Promise.resolve()).catch(err => console.error('Error loading Cast scripts:', err)); 