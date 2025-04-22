console.log('Background script loaded.');

let isCaptureActive = false;
// let recorder = null; // Removed - Not used in background script
let captureTabId = null; // Store the tab where the overlay/action was invoked
let streamId = null; // Store the desktop stream ID from the launcher

// --- Tab Capture Specific Variables ---
let targetTabIdForCapture = null; // Store the tab ID to be captured
// let recordedChunks = []; // Removed - No longer saving chunks

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
    console.log(`Action clicked on tab: ${captureTabId}, attempting to send toggle-overlay`);
    sendMessageToContentScript(captureTabId, { type: 'toggle-overlay' });
    // Add log right after calling send
    console.log(`Background: sendMessageToContentScript for toggle-overlay called for tab ${captureTabId}.`);
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
    'offscreen-recording-started', // Now means stream/preview active
    'offscreen-recording-stopped', // Now means stream/preview stopped
    'offscreen-error',
    // 'new-chunk', // Removed
    'preview-frame', // Still used for preview in content script
    'classification-result' // NEW: Forward from offscreen to content
  ];

  if (offscreenMessageTypes.includes(message.type)) {
      // console.log(`Background: Received message type ${message.type} from offscreen.`);
      switch (message.type) {
          case 'offscreen-recording-started':
              isCaptureActive = true;
              // recordedChunks = []; // Removed
              const tabToNotifyStart = targetTabIdForCapture || captureTabId;
              if (tabToNotifyStart) {
                  sendMessageToContentScript(tabToNotifyStart, { type: 'capture-state-active' });
              }
              break;
          case 'offscreen-recording-stopped':
              // processRecordedData(); // Removed - No data to process
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
          // case 'new-chunk': // Removed
          //     if (message.payload?.chunk) {
          //         recordedChunks.push(message.payload.chunk);
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
           case 'classification-result': // NEW: Forward classification result
              const targetClassTab = targetTabIdForCapture || captureTabId;
              if (isCaptureActive && targetClassTab && message.payload) {
                   sendMessageToContentScript(targetClassTab, {
                       type: 'classification-result',
                       payload: message.payload // Forward the payload directly
                   });
              }
              break;
      }
      return false; // Indicate message handled, stop processing
  }

  // --- Handle Messages from Content Script / Launcher ---
  // console.log(`Background: Received message type ${message.type} from content/launcher.`);
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
        if (!isCaptureActive) {
            console.warn("Stop requested, but capture is not active.");
            // Optionally notify content script it's already stopped
            if (sender.tab?.id) {
                 sendMessageToContentScript(sender.tab.id, { type: 'capture-state-inactive', payload: { error: 'Capture was not active.' } });
            }
            return false;
        }
        // Simply tell the offscreen document to stop
        stopCapture(); // This now just sends 'stop-recording' to offscreen
        needsAsyncResponse = true;
        sendResponse({ success: true, message: "Stop signal sent to offscreen document." });
      break;

    default:
      console.warn(`Background: Unhandled message type: ${message.type}`);
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

// Generic start capture function (called by tab/desktop specific starts)
async function startCapture(captureType, streamId) {
  console.log(`startCapture called. Type: ${captureType}, Has Stream ID: ${!!streamId}`);
  if (!(await hasOffscreenDocument())) {
    console.log("Creating offscreen document...");
    await setupOffscreenDocument();
  }

  // Send the command to the offscreen document to start recording
  chrome.runtime.sendMessage({
    type: 'start-recording',
    target: 'offscreen',
    payload: { streamId: streamId, captureType: captureType } // Pass both
  }).then(response => {
      console.log("Background: Sent start-recording to offscreen, response:", response);
      // No longer need to do anything specific here on success
  }).catch(err => {
    console.error("Background: Error sending start-recording message to offscreen:", err);
    // Send error back to the content script
    const errorTab = targetTabIdForCapture || captureTabId;
    if (errorTab) {
      sendMessageToContentScript(errorTab, {
        type: 'capture-state-inactive',
        payload: { error: `Failed to communicate with offscreen document: ${err.message}` }
      });
    }
    cleanupState();
  });
}

// Generic stop capture function
function stopCapture() {
  if (!isCaptureActive) {
    console.warn("stopCapture called, but capture wasn't active.");
    return; // Nothing to do if not active
  }

  console.log("Background: Sending stop-recording message to offscreen document...");
  // Send stop message to offscreen document
  chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' })
    .catch(error => {
      console.warn("Background: Error sending stop message to offscreen (maybe already closed?):", error.message);
      // If sending fails, the offscreen doc might already be gone.
      // We should still clean up the background state.
      cleanupState();
      const errorTab = targetTabIdForCapture || captureTabId;
      if (errorTab) {
        // Notify UI just in case
        sendMessageToContentScript(errorTab, { type: 'capture-state-inactive' });
      }
    });
  // Note: Actual state cleanup (isCaptureActive = false) happens when
  // 'offscreen-recording-stopped' message is received back.
}

// --- Cleanup Background State ---
function cleanupState() {
    console.log("Cleaning up background state...");
    isCaptureActive = false;
    // recordedChunks = []; // Removed
    // streamId = null; // Keep streamId if it came from desktop picker? No, clear it.
    streamId = null;
    // Keep captureTabId for potential future interactions?
    // captureTabId = null; // Clear initiating tab ID?
    targetTabIdForCapture = null; // Clear specific tab target

    // Attempt to close the offscreen document if it exists
    closeOffscreenDocument().catch(err => {
        // Ignore errors here, maybe already closed
        // console.warn("Ignoring error during cleanup closeOffscreenDocument:", err.message);
    });
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
  console.log("Initiating Tab Capture...");
  if (!targetTabIdForCapture) {
      console.error("Cannot start tab capture, targetTabIdForCapture is not set.");
      // Notify the original initiating tab (if known)
      if (captureTabId) {
           sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: 'Target tab for capture not set.' } });
      }
      cleanupState();
      return;
  }

  try {
      // Using chrome.tabCapture.getMediaStreamId requires the active tab to be the target
      // This is usually okay as the user action likely triggered it from the target tab.
      const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: targetTabIdForCapture });
      console.log(`Tab capture stream ID obtained: ${streamId} for tab ${targetTabIdForCapture}`);
      if (!streamId) {
          throw new Error("Failed to get tab capture stream ID (returned null/empty).");
      }
      await startCapture('tab', streamId); // Pass type and streamId
  } catch (error) {
      console.error("Error getting tab capture stream ID:", error);
      sendMessageToContentScript(targetTabIdForCapture, {
          type: 'capture-state-inactive',
          payload: { error: `Failed to start tab capture: ${error.message}` }
      });
      cleanupState();
  }
}

// --- MODIFIED: Start Desktop/Window Capture Process ---
async function startDesktopCapture(desktopStreamId) {
    console.log("Initiating Desktop Capture with stream ID:", desktopStreamId);
    if (!desktopStreamId) {
        console.error("startDesktopCapture called without stream ID.");
        if (captureTabId) {
             sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: 'Desktop stream ID missing.' } });
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

console.log("Background script event listeners added.");