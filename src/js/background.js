console.log('Background script loaded.');

let isCaptureActive = false;
let captureTabId = null;
let streamId = null;

let targetTabIdForCapture = null;
let tabMutedState = {};
let fullscreenedWindow = null;

let lastPrediction = null;
let adaptiveSoundEnabled = true;

let fallbackTabId = null;
let lastBasketballState = null;

let uiActiveTabId = null;

let tabSwitchEnabled = false;

let sceneDetectionThreshold = 0.15;

// Store the last preview frame to send to newly opened popups
let lastPreviewFrame = null;

// Add timers for debouncing mute/unmute operations
let muteDebounceTimers = {};

// Function to send messages to content scripts
function sendMessageToContentScript(tabId, message) {
  if (!tabId) {
    console.error("Cannot send message to content script: No tab ID provided");
    return;
  }
  chrome.tabs.sendMessage(tabId, message).catch(error => {
    console.warn(`Error sending message type ${message.type} to tab ${tabId}:`, error.message);
  });
}

// 1. Action Clicked: Toggle the overlay UI in the active tab
chrome.action.onClicked.addListener(async (tab) => {
    if (!tab.id) {
        console.error("Action click: No tab ID found.");
        return;
    }
    const clickedTabId = tab.id;
    console.log(`Action clicked on tab: ${clickedTabId}`);

    const activeCaptureTabId = targetTabIdForCapture || captureTabId; 
    if (isCaptureActive && activeCaptureTabId === clickedTabId) {
        console.log(`Background: Capture active on this tab (${clickedTabId}). Sending toggle-overlay to potentially show UI.`);
        sendMessageToContentScript(clickedTabId, { type: 'toggle-overlay' });
        return;
    }

    console.log(`Background: No active capture on tab ${clickedTabId} or capture inactive. Ensuring script and sending toggle-overlay.`);
    captureTabId = clickedTabId;
});

let creatingOffscreenDocument = false;

// Function to CHECK Offscreen permission (Does NOT request)
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
  if (message.type === 'page-fullscreen-change') {
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;
    console.log(`Background: Tab ${tabId} HTML5 fullscreen state = ${message.isHtml5Full}`);
    if (windowId != null) {
      if (message.isHtml5Full) {
        chrome.windows.update(windowId, { state: 'fullscreen' }, () => {
          if (chrome.runtime.lastError) console.error('Error entering fullscreen window:', chrome.runtime.lastError.message);
        });
      } else {
        chrome.windows.update(windowId, { state: 'normal' }, () => {
          if (chrome.runtime.lastError) console.error('Error exiting fullscreen window:', chrome.runtime.lastError.message);
        });
      }
    }
    return false;
  }
  let needsAsyncResponse = false;

  const offscreenMessageTypes = [
    'offscreen-recording-started',
    'offscreen-recording-stopped',
    'offscreen-error',
    'preview-frame',
    'onnxPrediction'
  ];

  // (message.target === 'offscreen' isn't reliable if sender is the background script itself)
  if (offscreenMessageTypes.includes(message.type)) {
      switch (message.type) {
          case 'offscreen-recording-started':
              isCaptureActive = true;
              chrome.runtime.sendMessage({ type: 'capture-state-active' });
              break;
          case 'offscreen-recording-stopped':
              const _tabToUnmute = targetTabIdForCapture || captureTabId;
              cleanupState();
              if (_tabToUnmute) {
                chrome.tabs.update(_tabToUnmute, { muted: false })
                  .catch(err => console.error('Failed to unmute tab after stopping capture:', err));
              }
              chrome.runtime.sendMessage({ type: 'capture-state-inactive' });
              break;
          case 'offscreen-error':
              const error = message.payload?.error || 'Unknown error';
              console.error("Received error from offscreen document:", error);
              stopCapture();
              chrome.runtime.sendMessage({
                  type: 'capture-state-inactive',
                  payload: { error: `Offscreen recording error: ${error}` }
              });
              break;
          case 'preview-frame':
              if (message.payload?.frameDataUrl) {
                  // Store the latest preview frame
                  lastPreviewFrame = message.payload.frameDataUrl;
                  
                  chrome.runtime.sendMessage({
                      type: 'preview-frame',
                      payload: { frameDataUrl: message.payload.frameDataUrl }
                  });
              }
              break;
          case 'onnxPrediction':
              if (isCaptureActive && message.payload?.prediction) {
                  const { prediction } = message.payload;
                  const activeTab = targetTabIdForCapture || captureTabId;
                  console.log(`Background: Classifier result: ${prediction} (activeTabId: ${activeTab}, fallbackTabId: ${fallbackTabId})`);
                  lastPrediction = prediction;
                  chrome.runtime.sendMessage({ type: 'onnxPrediction', payload: { prediction } });

                  // Mute/unmute logic with debouncing
                  const shouldBeMuted = prediction !== 'Basketball Detected';
                  if (adaptiveSoundEnabled) {
                      const tabId = message.payload.tabId;
                      
                      // Clear any existing timeout for this tab
                      if (muteDebounceTimers[tabId]) {
                          clearTimeout(muteDebounceTimers[tabId]);
                          delete muteDebounceTimers[tabId];
                      }
                      
                      // Only schedule a state change if the current state is different
                      if (tabMutedState[tabId] !== shouldBeMuted) {
                          console.log(`Background: Scheduling mute state update for tab ${tabId} to ${shouldBeMuted} in 500ms`);
                          
                          // Set a new timeout
                          muteDebounceTimers[tabId] = setTimeout(() => {
                              console.log(`Background: Executing delayed mute state update for tab ${tabId} to ${shouldBeMuted}`);
                              chrome.tabs.update(tabId, { muted: shouldBeMuted })
                                .then(() => { 
                                    tabMutedState[tabId] = shouldBeMuted; 
                                    delete muteDebounceTimers[tabId];
                                })
                                .catch(err => { 
                                    console.error('Background: Failed to update mute state:', err); 
                                    delete tabMutedState[tabId];
                                    delete muteDebounceTimers[tabId];
                                });
                          }, 500);
                      }
                  } else {
                      const tabId = message.payload.tabId;
                      // Clear any existing timeout
                      if (muteDebounceTimers[tabId]) {
                          clearTimeout(muteDebounceTimers[tabId]);
                          delete muteDebounceTimers[tabId];
                      }
                      
                      if (tabMutedState[tabId]) {
                          chrome.tabs.update(tabId, { muted: false })
                            .then(() => delete tabMutedState[tabId])
                            .catch(err => console.error('Background: Failed to unmute on adaptive-sound-off:', err));
                      }
                  }

                  // UI switching: only on a change of basketball state and only if tab switching is enabled
                  const isBasketball = (prediction === 'Basketball Detected');
                  if (lastBasketballState === null) {
                      lastBasketballState = isBasketball;
                  } else if (isBasketball !== lastBasketballState && tabSwitchEnabled) {
                      const targetTab = isBasketball ? captureTabId : fallbackTabId;
                      if (targetTab != null) {
                          console.log(`Background: Switching UI from tab ${uiActiveTabId} to ${targetTab} (basketball=${isBasketball})`);
                          if (isBasketball && fallbackTabId != null) {
                            chrome.scripting.executeScript({
                              target: { tabId: fallbackTabId },
                              func: () => document.querySelectorAll('video').forEach(v => v.pause())
                            });
                          }
                          chrome.tabs.update(targetTab, { active: true })
                            .then(() => {
                              console.log(`Background: Active tab now ${targetTab}`);
                              uiActiveTabId = targetTab;
                              if (!isBasketball && targetTab === fallbackTabId) {
                                chrome.scripting.executeScript({
                                  target: { tabId: targetTab },
                                  func: () => document.querySelectorAll('video').forEach(v => v.play())
                                });
                              }
                            })
                            .catch(err => console.error('Background: Tab switch failed', err));
                      }
                      lastBasketballState = isBasketball;
                  }
              } else {
                  console.warn('Background: Received onnxPrediction but no prediction or inactive capture.', message.payload);
              }
              break;
      }
      return false;
  }

  // Only log most content/launcher messages (skip prediction-event)
  if (message.type !== 'prediction-event') {
    console.log(`Background: Received message type ${message.type} from content/launcher.`);
  }
  switch (message.type) {
    case 'request-capture-state':
      console.log("Background: Received request-capture-state from popup.");
      const activeTabId = targetTabIdForCapture || captureTabId;
      uiActiveTabId = activeTabId;
      sendResponse({ 
        success: true, 
        isActive: isCaptureActive, 
        targetTabId: activeTabId, 
        fallbackTabId, 
        tabSwitchEnabled,
        adaptiveSoundEnabled,
        sceneDetectionThreshold,
        lastBasketballState,
        lastPrediction,
        lastPreviewFrame
      });
      return false;
    case 'set-adaptive-sound':
      adaptiveSoundEnabled = !!message.enabled;
      console.log(`Background: Adaptive sound set to ${adaptiveSoundEnabled}`);
      if (!adaptiveSoundEnabled) {
        // Clear any pending mute operations
        for (const tabId in muteDebounceTimers) {
          clearTimeout(muteDebounceTimers[tabId]);
          delete muteDebounceTimers[tabId];
        }
        
        const tabToRestore = targetTabIdForCapture || captureTabId;
        if (tabToRestore && tabMutedState[tabToRestore]) {
          chrome.tabs.update(tabToRestore, { muted: false })
            .then(() => delete tabMutedState[tabToRestore])
            .catch(err => console.error('Background: Failed to unmute on disable adaptive sound:', err));
        }
      }
      sendResponse({ success: true });
      return false;
    case 'request-start-tab-capture':
        console.log("Received request-start-tab-capture.");
        needsAsyncResponse = true;

        (async () => {
            if (isCaptureActive) {
                console.warn("Start tab capture requested, but capture is already active.");
                sendResponse({ success: false, error: "Capture already active" });
                return;
            }
            const tabId = message.tabId ?? sender.tab?.id;
            if (!tabId) {
                console.error("Cannot start tab capture, no target tab identified.");
                sendResponse({ success: false, error: "No target tab identified" });
                return;
            }
            targetTabIdForCapture = tabId;
            captureTabId = tabId;
            console.log(`Tab capture initiated for tab ID: ${targetTabIdForCapture}`);

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
                 return;
            }

            if (!granted) {
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

            try {
              await chrome.scripting.executeScript({
                target: { tabId: tabId },
                func: () => {
                  console.log('Fullscreen watcher injected');
                  const notify = () => {
                    const isFull = !!(
                      document.fullscreenElement ||
                      document.webkitFullscreenElement ||
                      document.mozFullScreenElement ||
                      document.msFullscreenElement
                    );
                    chrome.runtime.sendMessage({
                      type: 'page-fullscreen-change',
                      isHtml5Full: isFull
                    });
                  };
                  notify();
                  document.addEventListener('fullscreenchange', notify);
                  document.addEventListener('webkitfullscreenchange', notify);
                  document.addEventListener('mozfullscreenchange', notify);
                  document.addEventListener('MSFullscreenChange', notify);
                }
              });
              console.log(`Background: Injected inline fullscreen watcher into tab ${tabId}`);
            } catch (err) {
              console.error('Background: Failed to inject inline fullscreen watcher', err);
            }

            startTabCapture();
            sendResponse({ success: true, message: "Tab capture initiated" });
        })();

      break;

    case 'request-start-capture':
        console.log("Received request-start-capture (for desktop/window).");
        targetTabIdForCapture = null;
        if (isCaptureActive) {
            console.warn("Start requested, but capture is already active.");
            sendResponse({ success: false, error: "Capture already active" });
            return false;
        }
        if (sender.tab) {
            captureTabId = sender.tab.id;
            console.log(`Desktop capture initiated from tab: ${captureTabId}`);
        } else {
            console.warn("Start request received without sender tab info.");
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

    case 'capture-stream-id-selected':
        console.log('Received capture-stream-id-selected from launcher:', message.streamId);
        targetTabIdForCapture = null;
        if (!message.streamId) {
            console.error("Stream ID is missing in message from launcher!");
             if(captureTabId) {
                 sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: 'Stream ID selection failed or was missing.' } });
             }
            cleanupState();
            sendResponse({ success: false, error: "Stream ID missing" });
            return false;
        }
        startDesktopCapture(message.streamId);
        needsAsyncResponse = true;
        sendResponse({ success: true });
      break;

    case 'capture-stream-id-cancelled':
        console.warn("Launcher selection cancelled or failed.");
        targetTabIdForCapture = null;
        if(captureTabId) {
            sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: 'User cancelled media selection.' } });
        }
        cleanupState();
        sendResponse({ success: true });
        return false;
        break;

    case 'request-stop-capture':
        console.log("Received request-stop-capture");
        stopCapture();
        break;

    case 'request-last-prediction':
        sendResponse({ success: true, prediction: lastPrediction });
        return false;

    case 'request-switch-tab-capture':
        console.log(`Received request-switch-tab-capture for tab ${message.tabId}`);
        if (isCaptureActive) {
            stopCapture();
            setTimeout(() => {
                const newTab = message.tabId;
                if (newTab) {
                    targetTabIdForCapture = newTab;
                    captureTabId = newTab;
                    console.log(`Background: Switching capture to tab ${newTab}`);
                    startTabCapture();
                }
            }, 500);
        } else if (message.tabId) {
            targetTabIdForCapture = message.tabId;
            captureTabId = message.tabId;
            console.log(`Background: Starting capture on tab ${message.tabId}`);
            startTabCapture();
        }
        sendResponse({ success: true });
        return false;

    case 'set-fallback-tab':
      fallbackTabId = message.tabId;
      console.log(`Background: Fallback tab set to ${fallbackTabId}`);
      sendResponse({ success: true });
      return false;

    case 'prediction-event':
      const isBasketball = !!message.isBasketball;
      if (lastBasketballState === null) {
        lastBasketballState = isBasketball;
        sendResponse({ success: true });
        return false;
      }
      if (isBasketball !== lastBasketballState && tabSwitchEnabled) {
        const targetTab = isBasketball ? captureTabId : fallbackTabId;
        if (targetTab != null) {
          console.log(`Background: Switching UI from tab ${uiActiveTabId} to ${targetTab} (basketball=${isBasketball})`);
          if (isBasketball && fallbackTabId != null) {
            chrome.scripting.executeScript({
              target: { tabId: fallbackTabId },
              func: () => document.querySelectorAll('video').forEach(v => v.pause())
            });
          }
          chrome.tabs.update(targetTab, { active: true })
            .then(() => {
              console.log(`Background: Active tab now ${targetTab}`);
              uiActiveTabId = targetTab;
              if (!isBasketball && targetTab === fallbackTabId) {
                chrome.scripting.executeScript({
                  target: { tabId: targetTab },
                  func: () => document.querySelectorAll('video').forEach(v => v.play())
                });
              }
            })
            .catch(err => console.error('Background: Tab switch failed', err));
        }
        lastBasketballState = isBasketball;
      }
      sendResponse({ success: true });
      return false;

    case 'set-tab-switch':
      tabSwitchEnabled = !!message.enabled;
      console.log(`Background: Tab-switching set to ${tabSwitchEnabled}`);
      sendResponse({ success: true });
      return false;

    case 'reset-basketball-state':
      lastBasketballState = null;
      console.log(`Background: Basketball state reset due to tab switching being disabled`);
      sendResponse({ success: true });
      return false;

    case 'update-scene-sensitivity':
        console.log('Received update-scene-sensitivity:', message.threshold);
        // Store the value in case offscreen document is created later
        sceneDetectionThreshold = message.threshold;
        
        // Need to set async response flag
        needsAsyncResponse = true;
        
        // Use Promise to check if offscreen document exists and forward message
        hasOffscreenDocument().then(exists => {
            if (exists) {
                chrome.runtime.sendMessage({
                    target: 'offscreen',
                    type: 'update-scene-sensitivity',
                    payload: { threshold: message.threshold }
                }).catch(err => {
                    console.warn('Failed to forward scene sensitivity update to offscreen:', err);
                });
            }
            sendResponse({ success: true });
        }).catch(err => {
            console.error('Error checking offscreen document status:', err);
            sendResponse({ success: true });
        });
        break;

    default:
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
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH)]
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
                  resolve(await hasOffscreenDocument());
              }
          }, 100);
      });
  }
  if (await hasOffscreenDocument()) {
    console.log("Offscreen document already exists.");
    return true;
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
    return true;
  } catch (error) {
    console.error("Failed to create offscreen document:", error);
    const errorTabToNotify = targetTabIdForCapture || captureTabId;
    if (errorTabToNotify) {
      sendMessageToContentScript(errorTabToNotify, {
        type: 'capture-state-inactive',
        payload: { error: 'Failed to initialize recorder.' }
      });
    }
    cleanupState();
    return false;
  } finally {
    creatingOffscreenDocument = false;
  }
}

// 3. Start the actual media capture process
async function startCapture(streamId, captureType) {
    if (!streamId || !captureType) {
        console.error("Background: startCapture called without streamId or captureType.");
        cleanupState();
        return;
    }

    console.log(`Background: Preparing to start ${captureType} capture with streamId: ${streamId}`);

    // Prefer specific target, fallback to initiator
    const tabIdToPass = targetTabIdForCapture || captureTabId;
    if (!tabIdToPass) {
        console.error("Background: Cannot start capture - unable to determine target tab ID.");
        cleanupState();
        if (captureTabId) {
            sendMessageToContentScript(captureTabId, { type: 'capture-state-inactive', payload: { error: 'Failed to determine target tab ID for capture.' } });
        }
        return;
    }
     console.log(`Background: Offscreen document will be associated with tab ID: ${tabIdToPass}`);

    delete tabMutedState[tabIdToPass];

    try {
        // This handles cases where a previous capture might have failed uncleanly.
        if (await hasOffscreenDocument(OFFSCREEN_DOCUMENT_PATH)) {
            console.warn("Background: Found existing offscreen document before starting. Closing it.");
            await closeOffscreenDocument();
        }

        await setupOffscreenDocument();

        console.log("Background: Sending 'start-recording' message to offscreen document.");
        await chrome.runtime.sendMessage({
          type: 'start-recording',
          target: 'offscreen',
          payload: {
            streamId: streamId,
            captureType: captureType,
            tabId: tabIdToPass,
            sceneDetectionThreshold: sceneDetectionThreshold
          }
        });
        console.log("Background: 'start-recording' message sent.");
        // State (like isCaptureActive) is set when 'offscreen-recording-started' is received back
    } catch (error) {
        console.error("Background: Error during startCapture:", error);
        const errorMsg = error.message || String(error);
        const tabToNotifyError = targetTabIdForCapture || captureTabId;
         if(tabToNotifyError) {
            sendMessageToContentScript(tabToNotifyError, { type: 'capture-state-inactive', payload: { error: `Failed to start capture: ${errorMsg}` } });
         }
        await closeOffscreenDocument();
        cleanupState();
    }
}

// 4. Stop the capture
function stopCapture() {
    console.log("stopCapture called.");
    if (!isCaptureActive) {
         console.log("stopCapture called, but background state is not active.");
         cleanupState();
         closeOffscreenDocument();
         return;
    }

    console.log("Sending stop message to offscreen document...");
    // No need to check hasOffscreenDocument, send anyway, it will fail gracefully if closed
    chrome.runtime.sendMessage({ type: 'stop-recording', target: 'offscreen' })
        .catch(err => console.warn("Could not send stop message to offscreen:", err.message)); // Usually means it's already closed

    // Important: Don't reset state immediately here.
    // Wait for 'offscreen-recording-stopped' message which signifies
    // recording has actually stopped and potentially data is ready.
    // cleanupState() will be called when that message is received.
}

function cleanupState() {
    console.log("Background: Cleaning up state.");
    isCaptureActive = false;
    streamId = null;
    captureTabId = null;
    targetTabIdForCapture = null;

    // Clear any pending mute/unmute timers
    for (const tabId in muteDebounceTimers) {
        clearTimeout(muteDebounceTimers[tabId]);
        delete muteDebounceTimers[tabId];
    }
    
    restoreWindowState();

    console.log("Background: State cleanup complete.");
}

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
  if (isCaptureActive || streamId) {
      stopCapture();
      closeOffscreenDocument();
  }
});

console.log("Background script fully initialized and event listeners registered.");

async function startTabCapture() {
    if (isCaptureActive) {
        console.warn("Background: Tab capture requested, but already active.");
        return;
    }
    if (!targetTabIdForCapture) {
         console.error("Background: Cannot start tab capture, targetTabIdForCapture is not set.");
         return;
    }

    console.log(`Background: Attempting chrome.tabCapture.getMediaStreamId for tab ${targetTabIdForCapture}`);

    try {
        const tab = await chrome.tabs.get(targetTabIdForCapture);
        if(tab.windowId) {
            // await setWindowFullscreen(tab.windowId);
            console.log(`[${new Date().toISOString()}] Before Background`);
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log(`[${new Date().toISOString()}] Background: Delay complete after fullscreen.`);
        }
        const streamId = await chrome.tabCapture.getMediaStreamId({
          targetTabId: targetTabIdForCapture
        });

        if (!streamId) {
            throw new Error("Failed to get media stream ID (returned null/undefined).");
        }

        console.log(`Background: Obtained media stream ID: ${streamId} for tab ${targetTabIdForCapture}`);
        await startCapture(streamId, 'tab');

    } catch (error) {
        console.error("Background: Error starting tab capture:", error);
         const errorMsg = error.message || String(error);
        sendMessageToContentScript(targetTabIdForCapture, { type: 'capture-state-inactive', payload: { error: `Failed to start tab capture: ${errorMsg}` } });
        cleanupState();
    }
}

async function startDesktopCapture(desktopStreamId) {
    if (isCaptureActive) {
        console.warn("Background: Desktop capture requested, but already active.");
        return;
    }
     if (!desktopStreamId) {
         console.error("Background: startDesktopCapture called without desktopStreamId.");
         return;
     }
     if (!captureTabId) {
         // Proceeding, but offscreen document might not get the correct tabId if targetTabIdForCapture is also null
         console.warn("Background: Starting desktop capture, but initiating tab ID (captureTabId) is unknown.");
     }

    console.log(`Background: Starting desktop capture with stream ID: ${desktopStreamId}`);

    if (captureTabId) {
        try {
            const tab = await chrome.tabs.get(captureTabId);
            if (tab.windowId) {
                await new Promise(resolve => setTimeout(resolve, 750));
                console.log("Background: Delay complete after fullscreen.");
            }
        } catch (error) {
            console.warn(`Could not get initiating tab ${captureTabId} to make window fullscreen:`, error);
        }
    }

    await startCapture(desktopStreamId, 'desktop');
}


async function setWindowFullscreen(windowId) {
  if (!windowId) {
    console.error("setWindowFullscreen: No window ID provided.");
    return;
  }
  if (fullscreenedWindow?.id === windowId) {
      console.warn(`setWindowFullscreen: Window ${windowId} is already being managed for fullscreen.`);
      return;
  }

  console.log(`setWindowFullscreen: Attempting to make window ${windowId} fullscreen.`);
  try {
    const window = await chrome.windows.get(windowId);
    if (window.state === 'fullscreen') {
        console.log(`Window ${windowId} is already fullscreen.`);
        // Store it anyway so we can restore if needed
        fullscreenedWindow = { id: windowId, previousState: 'fullscreen' };
        return;
    }

    const previousState = window.state;
    fullscreenedWindow = { id: windowId, previousState: previousState };
    console.log(`Stored previous state '${previousState}' for window ${windowId}.`);

    await chrome.windows.update(windowId, { state: 'fullscreen', focused: true });
    console.log(`Window ${windowId} successfully set to fullscreen.`);

  } catch (error) {
    console.error(`Error setting window ${windowId} to fullscreen:`, error?.message || error);
    fullscreenedWindow = null;
  }
}

async function restoreWindowState() {
  if (!fullscreenedWindow?.id || !fullscreenedWindow?.previousState) {
    // console.log("restoreWindowState: No window state to restore."); // Can be noisy
    return;
  }

  const { id: windowId, previousState } = fullscreenedWindow;
  console.log(`restoreWindowState: Attempting to restore window ${windowId} to state '${previousState}'.`);

  // Reset stored state immediately to prevent race conditions/multiple attempts
  fullscreenedWindow = null;

  try {
    const currentWindow = await chrome.windows.get(windowId);
    // Only restore if it's currently fullscreen (don't override user changes)
    if (currentWindow.state === 'fullscreen') {
      await chrome.windows.update(windowId, { state: previousState });
      console.log(`Window ${windowId} successfully restored to state '${previousState}'.`);
    } else {
        console.log(`Window ${windowId} is no longer fullscreen (state: ${currentWindow.state}). Skipping restore.`);
    }
  } catch (error) {
    // Error likely means window was closed
    console.warn(`Could not restore state for window ${windowId} (maybe closed?):`, error?.message || error);
  }
}

