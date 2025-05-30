// This script runs immediately in launcher.html

// Define stubs to avoid ReferenceErrors until Cast helpers load
var isCasting = function() {
  return window.castHelpers && typeof window.castHelpers.isCasting === 'function'
    ? window.castHelpers.isCasting()
    : false;
};
var maybeClose = function(delay) {
  if (delay) setTimeout(() => window.close(), delay);
  else window.close();
};

console.log("Launcher script started.");

const recordTabButton = document.getElementById('start-capture-btn');
const stopCaptureButton = document.getElementById('stop-capture-btn');
const previewToggleButton = document.getElementById('adentify-preview-toggle-btn');
const predictionDisplay = document.getElementById('adentify-prediction');
let selectedTabId = null;
let baseTabId = null;
// Track whether we're capturing base or selected tab
let currentSwitchState = null; // 'basketball' or 'selected'

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
          // Start tab capture immediately
          const tabId = selectedTabId ?? baseTabId ?? currentTabId;
          chrome.runtime.sendMessage(
            { type: 'request-start-tab-capture', tabId },
            (response) => {
              if (response?.success) {
                setState(UIState.CAPTURING, tabId);
                maybeClose(500);
              } else {
                console.error('Failed to start tab capture', response);
              }
            }
          );
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
          // Always switch capture to the tab where the capture launcher was opened
          chrome.runtime.sendMessage({ type: 'request-switch-tab-capture', tabId: currentTabId });
          setState(UIState.CAPTURING);
          maybeClose(500);
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
    console.log("Launcher status:", message);
}

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

function handleBackgroundResponse(response, successMessage) {
    if (chrome.runtime.lastError) {
        updateStatus(`Error communicating with background: ${chrome.runtime.lastError.message}`);
        console.error("Error sending message:", chrome.runtime.lastError.message);
    } else if (response && response.success) {
        updateStatus(successMessage + " Closing...");
        console.log(successMessage, "Response:", response);
        maybeClose(500);
    } else {
        const errorMessage = response?.error || "Background script failed to process request.";
        updateStatus(`Error: ${errorMessage}`);
        console.warn("Background script response indicates failure:", response);
        if (recordTabButton) recordTabButton.disabled = false;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'close-launcher') {
        console.log('Received close request from background.');
        updateStatus("Closing launcher...");
        maybeClose();
        sendResponse({status: 'closing'});
        return true;
    }
});

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
        const isBasketball = (text === 'Basketball');
        // Notify background of classification so it can handle tab-switching
        chrome.runtime.sendMessage({ type: 'prediction-event', isBasketball });
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
});

document.addEventListener('DOMContentLoaded', () => {
    chrome.runtime.sendMessage({ type: 'request-capture-state' }, (resp) => {
        if (chrome.runtime.lastError || !resp?.success) return;
        // Remember original capture target as baseTabId
        baseTabId = resp.targetTabId;
        // Initialize fallback selection and tab-switch toggle from background
        if (resp.fallbackTabId != null) {
            selectedTabId = resp.fallbackTabId;
        }
        
        // Display the last preview frame if available
        if (resp.lastPreviewFrame) {
            const canvas = document.getElementById('adentify-preview-canvas');
            if (canvas) {
                const ctx = canvas.getContext('2d');
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                };
                img.src = resp.lastPreviewFrame;
            }
        }
        
        const tabSwitchToggle = document.getElementById('tab-switch-toggle');
        const selectorItem = document.querySelector('.tab-selector-item');
        if (tabSwitchToggle) {
            // Set initial toggle state
            tabSwitchToggle.checked = !!resp.tabSwitchEnabled;
            // Show/hide selector based on toggle
            if (selectorItem) selectorItem.style.display = tabSwitchToggle.checked ? 'flex' : 'none';
            // Notify background when changed
            tabSwitchToggle.addEventListener('change', () => {
                chrome.runtime.sendMessage({ type: 'set-tab-switch', enabled: tabSwitchToggle.checked });
                if (selectorItem) selectorItem.style.display = tabSwitchToggle.checked ? 'flex' : 'none';
                
                // Reset any active tab switching if toggle is turned off
                if (!tabSwitchToggle.checked) {
                    // Notify background to reset basketball state
                    chrome.runtime.sendMessage({ type: 'reset-basketball-state' });
                }
            });
        }
        
        // Set adaptive sound toggle state
        const adaptiveToggle = document.getElementById('adaptive-sound-toggle');
        if (adaptiveToggle && resp.adaptiveSoundEnabled !== undefined) {
            adaptiveToggle.checked = resp.adaptiveSoundEnabled;
        }
        
        // Set scene sensitivity slider state
        const sceneSlider = document.getElementById('scene-sensitivity-slider');
        if (sceneSlider && resp.sceneDetectionThreshold !== undefined) {
            sceneSlider.value = resp.sceneDetectionThreshold;
            updateSceneSensitivityDisplay(resp.sceneDetectionThreshold);
        }
        
        // Update basketball state display if available
        if (resp.lastBasketballState !== null) {
            const predText = resp.lastBasketballState ? 'Basketball' : 'No Basketball';
            const lp = document.getElementById('launcher-prediction');
            if (lp) lp.textContent = `Prediction: ${predText}`;
            
            // Also update the prediction display if it exists
            if (predictionDisplay) {
                predictionDisplay.textContent = predText;
                if (predText === 'Basketball') {
                    predictionDisplay.classList.add('prediction-basketball');
                } else {
                    predictionDisplay.classList.remove('prediction-basketball');
                }
            }
        } else if (resp.lastPrediction) {
            // Use lastPrediction as fallback when lastBasketballState is null
            const predText = resp.lastPrediction === 'Basketball Detected' ? 'Basketball' : 'No Basketball';
            const lp = document.getElementById('launcher-prediction');
            if (lp) lp.textContent = `Prediction: ${predText}`;
            
            // Also update the prediction display if it exists
            if (predictionDisplay) {
                predictionDisplay.textContent = predText;
                if (predText === 'Basketball') {
                    predictionDisplay.classList.add('prediction-basketball');
                } else {
                    predictionDisplay.classList.remove('prediction-basketball');
                }
            }
        }
        
        // Update initial UI state based on capture-state
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
        // Only send to background on changes, not on initial load
        adaptiveToggle.addEventListener('change', () => {
            chrome.runtime.sendMessage({ type: 'set-adaptive-sound', enabled: adaptiveToggle.checked });
        });
    }
    
    // Scene detection sensitivity slider
    const sceneSlider = document.getElementById('scene-sensitivity-slider');
    const sceneValue = document.getElementById('scene-sensitivity-value');
    if (sceneSlider && sceneValue) {
        // Initial value display is now handled by the request-capture-state response above
        
        // Listen for changes
        sceneSlider.addEventListener('input', function() {
            updateSceneSensitivityDisplay(this.value);
        });
        
        sceneSlider.addEventListener('change', function() {
            const threshold = parseFloat(this.value);
            // Send to background which will forward to offscreen
            chrome.runtime.sendMessage({ 
                type: 'update-scene-sensitivity', 
                threshold: threshold 
            });
        });
    }
    
    // Helper function to update sensitivity display
    function updateSceneSensitivityDisplay(value) {
        const percentage = Math.round(parseFloat(value) * 100);
        if (sceneValue) {
            sceneValue.textContent = `${percentage}%`;
        }
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
            // Set default to the fallback selection or active tab if none
            if (typeof selectedTabId === 'number') {
                tabSelector.value = selectedTabId;
            } else {
                chrome.tabs.query({ active: true, currentWindow: true }, (activeTabs) => {
                    const act = activeTabs[0];
                    if (act?.id != null) {
                        tabSelector.value = act.id;
                        selectedTabId = act.id;
                    }
                });
            }
        });
        tabSelector.addEventListener('change', () => {
            selectedTabId = parseInt(tabSelector.value, 10);
            console.log('Selected fallback tab ID:', selectedTabId);
            // Explicitly set the dropdown value in case it resets
            tabSelector.value = selectedTabId;
            // Inform background of new fallback tab for UI switching logic
            chrome.runtime.sendMessage({ type: 'set-fallback-tab', tabId: selectedTabId });
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