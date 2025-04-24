// This script runs immediately in launcher.html

console.log("Launcher script started.");

const recordTabButton = document.getElementById('start-capture-btn');
const stopCaptureButton = document.getElementById('stop-capture-btn');
const previewToggleButton = document.getElementById('adentify-preview-toggle-btn');
const predictionDisplay = document.getElementById('adentify-prediction');

// Update status function
function updateStatus(message) {
    // no-op: status messages removed
    console.log("Launcher status:", message);
}

// --- Event Listeners for Buttons ---

// Removed desktop capture option entirely

// Stop Capture Button
if (stopCaptureButton) {
    stopCaptureButton.addEventListener('click', () => {
        updateStatus('Stopping capture...');
        stopCaptureButton.disabled = true;
        // Request background to stop capture
        chrome.runtime.sendMessage({ type: 'request-stop-capture' });
        // Close launcher popup after a short delay
        setTimeout(() => window.close(), 500);
    });
} else {
    console.error("'stop-capture-btn' button not found.");
}

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
        // Close the launcher window after a short delay
        setTimeout(() => window.close(), 500);
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
        window.close();
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
            const ui = document.getElementById('adentify-ui');
            if (ui) {
                ui.classList.remove('hidden');
                ui.classList.add('recording-active');
            }
        }
        sendResponse({ status: 'preview-received' });
        return true;
    }
    // Handle prediction update
    if (message.type === 'onnxPrediction' && message.payload?.prediction) {
        const ui = document.getElementById('adentify-ui');
        if (ui) {
            ui.classList.remove('hidden');
            ui.classList.add('recording-active');
        }
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
        sendResponse({ status: 'prediction-updated' });
        return false;
    }
    // Let other listeners handle other message types (e.g., close-launcher)
});

// --- Initial State ---

document.addEventListener('DOMContentLoaded', () => {
    // Determine button states based on capture info and current tab
    chrome.runtime.sendMessage({ type: 'request-capture-state' }, (resp) => {
        if (chrome.runtime.lastError || !resp?.success) return;
        const isActive = resp.isActive;
        const targetTabId = resp.targetTabId;
        // Get current active tab ID
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const currentTabId = tabs[0]?.id;
            if (!isActive) {
                // Not capturing: show Start Adentifying
                if (recordTabButton) {
                    recordTabButton.textContent = 'Start Adentifying';
                    recordTabButton.style.display = 'block';
                    recordTabButton.onclick = () => {
                        chrome.runtime.sendMessage({ type: 'request-start-tab-capture', tabId: currentTabId });
                        window.close();
                    };
                }
                if (stopCaptureButton) stopCaptureButton.style.display = 'none';
            } else {
                if (currentTabId === targetTabId) {
                    // Capturing on this tab: show Stop Adentifying
                    if (recordTabButton) recordTabButton.style.display = 'none';
                    if (stopCaptureButton) {
                        stopCaptureButton.textContent = 'Stop Adentifying';
                        stopCaptureButton.style.display = 'block';
                    }
                } else {
                    // Capturing on another tab: allow switch and also stop
                    if (recordTabButton) {
                        recordTabButton.textContent = 'Start Adentifying here';
                        recordTabButton.style.display = 'block';
                        recordTabButton.onclick = () => {
                            chrome.runtime.sendMessage({ type: 'request-switch-tab-capture', tabId: currentTabId });
                            window.close();
                        };
                    }
                    if (stopCaptureButton) {
                        stopCaptureButton.textContent = 'Stop Adentifying';
                        stopCaptureButton.style.display = 'block';
                        stopCaptureButton.onclick = () => {
                            chrome.runtime.sendMessage({ type: 'request-stop-capture' });
                            window.close();
                        };
                    }
                }
            }
        });
    });
    // Load last known prediction
    chrome.runtime.sendMessage({ type: 'request-last-prediction' }, (r) => {
        if (!chrome.runtime.lastError && r?.success && r.prediction) {
            const txt = r.prediction === 'Basketball Detected' ? 'Basketball' : 'No Basketball';
            const lp = document.getElementById('launcher-prediction');
            if (lp) lp.textContent = `Prediction: ${txt}`;
        }
    });
});

console.log("Launcher script loaded and listeners attached."); 