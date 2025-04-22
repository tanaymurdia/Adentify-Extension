// This script runs immediately in launcher.html

console.log("Launcher script started.");

const statusElement = document.getElementById('status');
const recordDesktopButton = document.getElementById('record-desktop');
const recordTabButton = document.getElementById('record-tab');

// Update status function
function updateStatus(message) {
    if (statusElement) {
        statusElement.textContent = message;
    }
    console.log("Launcher status:", message);
}

// --- Event Listeners for Buttons ---

if (recordDesktopButton) {
    recordDesktopButton.addEventListener('click', () => {
        updateStatus('Requesting desktop/window selection...');
        recordDesktopButton.disabled = true; // Disable buttons
        recordTabButton.disabled = true;

        chrome.desktopCapture.chooseDesktopMedia(
            ["screen", "window"], // Only offer screen/window for this button
            (streamId, options) => {
                if (streamId) {
                    console.log('Desktop Stream ID selected:', streamId, 'Options:', options);
                    updateStatus('Stream selected. Sending to background...');
                    chrome.runtime.sendMessage({
                        type: 'capture-stream-id-selected',
                        streamId: streamId,
                        options: options
                    }, (response) => {
                        handleBackgroundResponse(response, "Desktop stream ID sent successfully.");
                    });
                } else {
                    console.log('User cancelled desktop media selection.');
                    updateStatus('Desktop media selection cancelled. Closing...');
                    chrome.runtime.sendMessage({ type: 'capture-stream-id-cancelled' }, (response) => {
                         handleBackgroundResponse(response, "Cancellation sent.");
                    });
                }
            }
        );
    });
} else {
    console.error("'record-desktop' button not found.");
}

if (recordTabButton) {
    recordTabButton.addEventListener('click', () => {
        updateStatus('Requesting tab capture start...');
        recordDesktopButton.disabled = true; // Disable buttons
        recordTabButton.disabled = true;

        // Send message to background script to initiate tab capture
        chrome.runtime.sendMessage({ type: 'request-start-tab-capture' }, (response) => {
            handleBackgroundResponse(response, "Tab capture request sent.");
        });
    });
} else {
    console.error("'record-tab' button not found.");
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
        if (recordDesktopButton) recordDesktopButton.disabled = false;
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

// --- Initial State ---

document.addEventListener('DOMContentLoaded', () => {
    updateStatus('Ready. Choose recording type.');
});

console.log("Launcher script loaded and listeners attached."); 