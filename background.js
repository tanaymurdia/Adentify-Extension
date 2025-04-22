console.log('Background script loaded.');

let isCaptureActive = false;
// let recorder = null; // Removed - Not used in background script
let captureTabId = null; // Store the tab where the overlay/action was invoked
let streamId = null; // Store the desktop stream ID from the launcher

// --- Tab Capture Specific Variables ---
let targetTabIdForCapture = null; // Store the tab ID to be captured
// let recordedChunks = []; // REMOVED - No longer saving video data

// Utility to send message to content script
function sendMessageToContentScript(tabId, message) {
  if (tabId) {
    chrome.tabs.sendMessage(tabId, message, { frameId: 0 })
      .then(() => {
          // Optional: Log successful send if needed (can be noisy)
          // console.log(`Background: Successfully sent ${message.type} to tab ${tabId}`);
      }).catch(error => {
        // Log error if sending fails (important!)
        console.error(`Background: Could not send message ${message.type} to tab ${tabId} (frame 0):`, error.message);
      });
  }
}

// 1. Action Clicked: Toggle the overlay UI in the active tab
chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id) {
        console.error("Action click: No tab ID found.");
        return;
    }
    captureTabId = tab.id;
    console.log(`Action clicked on tab: ${captureTabId}, ensuring content script and sending toggle-overlay`);

    try {
        // Ensure the content script is loaded before sending the message
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content_script.bundle.js'] // Ensure this matches your bundled output
        });
        // Optional: Inject CSS too if not relying on manifest injection
        // await chrome.scripting.insertCSS({
        //     target: { tabId: tab.id },
        //     files: ['overlay.css']
        // });

        // Now send the message
        sendMessageToContentScript(captureTabId, { type: 'toggle-overlay' });
        console.log(`Background: Sent toggle-overlay after ensuring script injection.`);
    } catch (error) {
        console.error(`Background: Failed to execute script or send message on tab ${tab.id}:`, error);
        // Optionally, notify the user via an extension badge or popup if the action fails
        // chrome.action.setBadgeText({ tabId: tab.id, text: 'ERR' });
        // chrome.action.setBadgeBackgroundColor({ tabId: tab.id, color: '#FF0000' });
    }
});

let creatingOffscreenDocument = false;

// --- Function to CHECK Offscreen permission (Does NOT request) ---
async function checkOffscreenPermission() {
  try {
    return await chrome.permissions.contains({ permissions: ['offscreen'] });
  } catch (error) {
      console.error("Error checking 'offscreen' permission:", error);
      return false;
  }
}

// 2. Listen for messages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let needsAsyncResponse = false;

  // --- Handle Messages FROM Offscreen Document FIRST ---
  const offscreenMessageTypes = [
    'offscreen-recording-started',
    'offscreen-recording-stopped',
    'offscreen-error',
    'preview-frame',
    'onnxPrediction'
  ];

  // Check if the message type is known to come from offscreen
  // (message.target === 'offscreen' isn't reliable if sender is the background script itself)
  if (offscreenMessageTypes.includes(message.type)) {
      console.log(`Background: Received message type ${message.type} from offscreen.`);
      switch (message.type) {
          case 'offscreen-recording-started':
              isCaptureActive = true;
              // recordedChunks = []; // REMOVED
              const tabToNotifyStart = targetTabIdForCapture || captureTabId;
              if (tabToNotifyStart) {
                  sendMessageToContentScript(tabToNotifyStart, { type: 'capture-state-active' });
              }
              break;
          case 'offscreen-recording-stopped':
              // processRecordedData(); // REMOVED - No longer processing/saving data
              cleanupState();
              const tabToNotifyStop = targetTabIdForCapture || captureTabId;
              if (tabToNotifyStop) {
                  sendMessageToContentScript(tabToNotifyStop, { type: 'capture-state-inactive' });
              }
              break;
          case 'offscreen-error':
              const error = message.payload?.error || 'Unknown error';
              console.error("Received error from offscreen document:", error);
              stopCapture(); // Stop potentially active capture
              const errorTabToNotify = targetTabIdForCapture || captureTabId;
              if (errorTabToNotify) {
                  sendMessageToContentScript(errorTabToNotify, {
                      type: 'capture-state-inactive',
                      payload: { error: `Offscreen recording error: ${error}` }
                  });
              }
              break;
          // case 'new-chunk': // REMOVED - Handler no longer needed
          //     if (message.payload?.chunk) {
          //         // recordedChunks.push(message.payload.chunk); // REMOVED
          //     } else {
          //         console.warn("Received 'new-chunk' message without chunk data.");
          //     }
          //     break;
          case 'preview-frame':
              const targetPreviewTab = targetTabIdForCapture || captureTabId;
              if (isCaptureActive && targetPreviewTab && message.payload?.frameDataUrl) {
                  sendMessageToContentScript(targetPreviewTab, {
                      type: 'preview-frame',
                      payload: { frameDataUrl: message.payload.frameDataUrl }
                  });
              }
              break;
          case 'onnxPrediction':
              const targetPredictionTab = targetTabIdForCapture || captureTabId;
              if (isCaptureActive && targetPredictionTab && message.payload?.prediction) {
                  sendMessageToContentScript(targetPredictionTab, {
                      type: 'onnxPrediction',
                      payload: { prediction: message.payload.prediction }
                  });
              } else {
                 console.warn("Background: Received onnxPrediction but capture not active or no target tab.");
              }
              break;
      }
      return false; // Indicate message handled, stop processing
  }

  // --- Handle Messages from Content Script / Launcher ---
  // Only process these if not handled above
  console.log(`Background: Received message type ${message.type} from content/launcher.`);
  switch (message.type) {
    case 'request-start-tab-capture':
        console.log("Received request-start-tab-capture.");
        needsAsyncResponse = true;

        (async () => {
            if (isCaptureActive) {
                console.warn("Start tab capture requested, but capture is already active.");
                sendResponse({ success: false, error: "Capture already active" });
                return;
            }
            if (!sender.tab) {
                 console.error("Cannot start tab capture, no sender tab identified.");
                 sendResponse({ success: false, error: "No sender tab identified" });
                 return;
            }
            targetTabIdForCapture = sender.tab.id;
            captureTabId = sender.tab.id;
            console.log(`Tab capture initiated for tab ID: ${targetTabIdForCapture}`);

            // --- Request Permission HERE (Directly) --- 
            let granted = false;
            try {
                console.log("Requesting 'offscreen' permission directly...");
                granted = await chrome.permissions.request({ permissions: ['offscreen'] });
            } catch (error) {
                 console.error("Error requesting 'offscreen' permission:", error);
                 // Check if it was the user gesture error specifically
                 if (error.message.includes("user gesture")) {
                     sendResponse({ success: false, error: "Permission request failed: Must be triggered by user action." });
                 } else {
                     sendResponse({ success: false, error: `Permission request failed: ${error.message}` });
                 }
                 return; // Stop if request fails
            }

            if (!granted) {
                 // It might be already granted, let's double check
                 console.log("Permission request returned false, checking if already granted...");
                 if (!(await checkOffscreenPermission())) {
                     console.error("Offscreen permission was not granted and request failed.");
                     sendResponse({ success: false, error: "Offscreen permission is required and was not granted." });
                     return;
                 } else {
                     console.log("Permission was already granted.");
                 }
            } else {
                 console.log("'offscreen' permission granted via request.");
            }
            // --- END Permission Request ---

            // If we reach here, permission should exist - proceed to start
            startTabCapture(); // This now assumes permission exists
            sendResponse({ success: true, message: "Tab capture initiated" });
        })();

      break;

    case 'request-start-capture':
        console.log("Received request-start-capture (for desktop/window).");
         targetTabIdForCapture = null; // Ensure tab capture ID is null
        if (isCaptureActive) {
            console.warn("Start requested, but capture is already active.");
            sendResponse({ success: false, error: "Capture already active" });
            return false;
        }
        if (sender.tab) {
            captureTabId = sender.tab.id; // Store the tab that initiated desktop capture
            console.log(`Desktop capture initiated from tab: ${captureTabId}`);
        } else {
            console.warn("Start request received without sender tab info.");
             // Use the last known action-clicked tab as a fallback? Risky.
            if (!captureTabId) {
                 console.error("Cannot start desktop capture, no initiating tab known.");
                 sendResponse({ success: false, error: "No initiating tab identified" });
                 return false;
            }
             console.log(`Using last known action click tab ID: ${captureTabId}`);
        }

        console.log("Opening launcher.html...");
        needsAsyncResponse = true;
        chrome.windows.create({
            url: chrome.runtime.getURL('launcher.html'),
            type: 'popup',
            width: 400,
            height: 250
        }).then(win => {
            console.log("Launcher window created:", win?.id);
            sendResponse({ success: true, message: "Launcher window opened" });
        }).catch(err => {
             console.error("Error creating launcher window:", err);
             if(captureTabId) {
                sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: `Failed to open capture selection window: ${err.message}` } });
             }
             cleanupState();
             sendResponse({ success: false, error: `Failed to create launcher window: ${err.message}` });
        });
      break;

    case 'capture-stream-id-selected': // From launcher
        console.log('Received capture-stream-id-selected from launcher:', message.streamId);
         targetTabIdForCapture = null; // Ensure tab capture ID is null
        if (!message.streamId) {
            console.error("Stream ID is missing in message from launcher!");
             if(captureTabId) {
                 sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: 'Stream ID selection failed or was missing.' } });
             }
            cleanupState();
            sendResponse({ success: false, error: "Stream ID missing" });
            return false;
        }
        // Use the specific function for desktop capture
        startDesktopCapture(message.streamId);
        needsAsyncResponse = true;
        sendResponse({ success: true });
      break;

    case 'capture-stream-id-cancelled': // From launcher
        console.warn("Launcher selection cancelled or failed.");
        targetTabIdForCapture = null;
        if(captureTabId) {
            sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: 'User cancelled media selection.' } });
        }
        cleanupState();
        sendResponse({ success: true });
        return false;
        break;

    case 'request-stop-capture': // From content script
        console.log("Received request-stop-capture");
        stopCapture();
        // Don't send response immediately, wait for confirmation from offscreen
        // sendResponse({ success: true }); // removed
        break;

    default:
      // This log should now only appear for truly unknown message types
      console.warn("Received genuinely unknown message type:", message.type);
      return false;
  }
  return needsAsyncResponse;
});

// --- Offscreen Document Management ---
const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';

async function hasOffscreenDocument() {
  // Use chrome.runtime.getContexts if available (more reliable)
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)] // Match specific URL
    });
    return !!contexts.length;
  } else {
    // Fallback using clients matching (less reliable)
    console.warn("chrome.runtime.getContexts not available, using less reliable fallback.");
    // This requires the offscreen document to have a service worker client type.
    // If it doesn't, this fallback might not work.
    const clients = await self.clients.matchAll();
    return clients.some(client => client.url.endsWith('/' + OFFSCREEN_DOCUMENT_PATH));
  }
}

async function setupOffscreenDocument() {
  if (creatingOffscreenDocument) {
      console.log("Offscreen document creation already in progress, waiting...");
      // Basic wait logic: check every 100ms if creation finished
      // A more robust solution might use a Promise or event listener
      return new Promise(resolve => {
          const intervalId = setInterval(async () => {
              if (!creatingOffscreenDocument) {
                  clearInterval(intervalId);
                  resolve(await hasOffscreenDocument()); // Re-check if it exists now
              }
          }, 100);
      });
  }
  if (await hasOffscreenDocument()) {
    console.log("Offscreen document already exists.");
    return true; // Indicate success/existence
  }

  console.log("Creating offscreen document...");
  creatingOffscreenDocument = true;
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'AUDIO_PLAYBACK'],
      justification: 'Required for capturing tab audio/video and maintaining activity via silent audio',
    });
    console.log("Offscreen document created successfully.");
    return true; // Indicate success
  } catch (error) {
    console.error("Failed to create offscreen document:", error);
    const errorTabToNotify = targetTabIdForCapture || captureTabId;
    if (errorTabToNotify) {
      sendMessageToContentScript(errorTabToNotify, {
        type: 'capture-state-inactive',
        payload: { error: 'Failed to initialize recorder.' }
      });
    }
    cleanupState(); // Reset state if offscreen doc fails
    return false; // Indicate failure
  } finally {
    creatingOffscreenDocument = false;
  }
}

// --- End Offscreen Document Management ---

// 3. Start the actual media capture process
async function startCapture() {
    if (!streamId) {
        console.error("Cannot start capture without a stream ID.");
        if(captureTabId) {
            sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: 'Missing stream ID for capture.' } });
        }
        cleanupState();
        return;
    }
    if (!captureTabId) {
        console.error("Cannot start capture without a target tab ID.");
        // This shouldn't happen if the flow is correct, but handle defensively.
        cleanupState();
        return;
    }
     if (isCaptureActive) {
        console.warn("Start capture called but already active.");
        return;
    }

    console.log(`Starting capture process with stream ID: ${streamId} for tab ${captureTabId}`);

    // Ensure the offscreen document is ready
    await setupOffscreenDocument();
    if (!(await hasOffscreenDocument())) {
        console.error("Offscreen document setup failed or didn't complete in time.");
         if (captureTabId) {
             sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: 'Recorder setup failed.' } });
         }
         cleanupState();
        return;
    }

    // Send streamId to the offscreen document to start recording
    console.log("Sending streamId to offscreen document to start recording...");
    chrome.runtime.sendMessage({
        type: 'start-offscreen-recording',
        target: 'offscreen',
        payload: { streamId: streamId }
    }).catch(err => {
        console.error("Error sending start message to offscreen document:", err);
        if(captureTabId) {
            sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: `Failed to communicate with recorder: ${err.message}` } });
        }
        cleanupState(); // Clean up if sending message fails
    });

    // Note: Actual state `isCaptureActive = true` and sending `capture-state-active`
    // will now happen *after* we receive confirmation ('offscreen-recording-started')
    // from the offscreen document. This makes the UI state more accurate.
}

// 4. Stop the capture
function stopCapture() {
    console.log("stopCapture called.");
    // If already stopping or inactive, do nothing extra
    if (!isCaptureActive) { // Check if background thinks capture is active
         console.log("stopCapture called, but background state is not active.");
         // Still attempt cleanup, but don't send stop message if already inactive
         cleanupState();
         closeOffscreenDocument();
         return;
    }

    console.log("Sending stop message to offscreen document...");
    // Send message to offscreen document to stop recording
    // No need to check hasOffscreenDocument, send anyway, it will fail gracefully if closed
    chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' })
        .catch(err => console.warn("Could not send stop message to offscreen:", err.message)); // Usually means it's already closed

    // Important: Don't reset state immediately here.
    // Wait for 'offscreen-recording-stopped' message which signifies
    // recording has actually stopped and potentially data is ready.
    // cleanupState() will be called when that message is received.
    // isCaptureActive = false; // Move this to cleanupState or when 'offscreen-recording-stopped' received
}

// Utility function to reset state variables
function cleanupState() {
    console.log("Cleaning up background state.");
    isCaptureActive = false;
    // recorder = null; // Removed
    streamId = null;
    targetTabIdForCapture = null;
    // recordedChunks = []; // REMOVED
    // captureTabId is intentionally kept
}

// Function to close the offscreen document (optional)
async function closeOffscreenDocument() {
    if (await hasOffscreenDocument()) {
        console.log("Closing offscreen document.");
        await chrome.offscreen.closeDocument().catch(err => {
            console.warn("Error closing offscreen document (might be already closed):", err.message);
        });
    } else {
        console.log("No offscreen document to close.");
    }
}


// Handle extension unload (suspend, update, uninstall)
chrome.runtime.onSuspend?.addListener(() => { // Optional chaining for safety
  console.log("Extension suspending. Stopping capture if active.");
  if (isCaptureActive || streamId) { // Check if active or potentially starting
      stopCapture(); // Ensure cleanup
      closeOffscreenDocument(); // Close offscreen doc on suspend
  }
});

// Initial log to confirm script loaded and listeners should be registering
console.log("Background script fully initialized and event listeners registered.");

// --- NEW: Start Tab Capture Process ---
async function startTabCapture() {
    if (!targetTabIdForCapture) {
        console.error("Target tab ID for capture is not set.");
        return;
    }
    // Ensure offscreen document is ready
    const offscreenReady = await setupOffscreenDocument();
    if (!offscreenReady) {
        console.error("Failed to set up offscreen document for tab capture.");
        return; // setupOffscreenDocument should have handled error reporting
    }

    try {
        console.log(`Requesting stream ID for tab: ${targetTabIdForCapture}`);
        // Get the stream ID for the target tab
        const tabStreamId = await chrome.tabCapture.getMediaStreamId({
            targetTabId: targetTabIdForCapture
        });

        if (!tabStreamId) {
             console.error("Failed to get stream ID for tab capture.");
             throw new Error("Could not get tab media stream ID.");
        }

        console.log(`Obtained tab stream ID: ${tabStreamId}. Sending to offscreen doc.`);
        // Send message to offscreen document to start recording with this stream ID
        chrome.runtime.sendMessage({
            type: 'start-recording',
            target: 'offscreen', // Identify the target recipient
            payload: {
                captureType: 'tab', // Specify the type
                streamId: tabStreamId, // The crucial ID
                tabId: targetTabIdForCapture // Pass the tab ID for context if needed
                // Add any other config: quality, audio settings etc.
            }
        });
        // State change (isCaptureActive = true) will happen upon confirmation ('offscreen-recording-started')

    } catch (error) {
        console.error("Error during tab capture startup:", error);
        const errorTabToNotify = targetTabIdForCapture || captureTabId;
        if (errorTabToNotify) {
            sendMessageToContentScript(errorTabToNotify, {
                type: 'capture-state-inactive',
                payload: { error: `Tab capture failed: ${error.message}` }
            });
        }
        cleanupState();
        await closeOffscreenDocument(); // Attempt cleanup
    }
}

// --- MODIFIED: Start Desktop/Window Capture Process ---
async function startDesktopCapture(desktopStreamId) {
    if (!desktopStreamId) {
        console.error("Cannot start desktop capture without a stream ID.");
        if(captureTabId) { // Use the original initiating tab for error reporting
            sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: 'Missing stream ID for capture.' } });
        }
        cleanupState();
        return;
    }
    // Ensure offscreen document is ready
    const offscreenReady = await setupOffscreenDocument();
     if (!offscreenReady) {
        console.error("Failed to set up offscreen document for desktop capture.");
        return; // Error reported by setupOffscreenDocument
    }

    console.log(`Sending desktop stream ID (${desktopStreamId}) to offscreen document.`);
    // Send message to offscreen document to start recording
    chrome.runtime.sendMessage({
        type: 'start-recording',
        target: 'offscreen',
        payload: {
            captureType: 'desktop', // Specify the type
            streamId: desktopStreamId
            // Add any other config: quality, audio settings etc.
        }
    });
     // State change (isCaptureActive = true) will happen upon confirmation ('offscreen-recording-started')
}