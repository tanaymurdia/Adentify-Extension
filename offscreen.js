let recorder = null;
let mediaStream = null; // Store the stream obtained from getUserMedia
let previewVideoElement = null; // Hidden video element to play the stream
let previewCanvas = null; // Hidden canvas for frame grabbing
let previewCanvasCtx = null;
let previewIntervalId = null; // ID for setInterval
let audioContext = null; // Keep document awake
let oscillator = null; // Silent audio source
let onnxWorker = null; // Reference to the ONNX worker
let lastFrameSentToWorker = 0; // Timestamp for worker throttling

// Mime type configuration - adjust as needed
// const mimeType = 'video/webm;codecs=vp9'; // No longer needed
// const CHUNK_TIMESLICE_MS = 1000; // No longer needed
const PREVIEW_FRAME_RATE = 10; // FPS for sending *preview* frames to content script
const PREVIEW_QUALITY = 0.6; // JPEG quality for preview frames (0.0 to 1.0)
const WORKER_PROCESSING_INTERVAL_MS = 1000; // Send frames to worker every 1 second (1 FPS)

// --- NEW: Initialize Worker ---
function initializeWorker() {
    if (onnxWorker) return; // Already initialized

    try {
        // Assuming onnx_worker.js is bundled as onnx_worker.bundle.js by webpack
        onnxWorker = new Worker('onnx_worker.bundle.js'); // Use bundled worker name
        console.log("Offscreen: ONNX Worker instantiated.");

        onnxWorker.onmessage = (event) => {
            if (event.data && event.data.type === 'classification-result') {
                // console.log("Offscreen: Received result from worker:", event.data.payload);
                // Forward the result to the content script(s)
                sendMessageToContentScript({
                    type: 'classification-result',
                    payload: event.data.payload
                });
            } else {
                console.warn("Offscreen: Received unknown message from worker:", event.data);
            }
        };

        onnxWorker.onerror = (error) => {
            console.error("Offscreen: ONNX Worker error:", error);
            // Handle worker errors, maybe try to restart it or notify the user
        };
    } catch (error) {
        console.error("Offscreen: Failed to initialize ONNX Worker:", error);
    }
}

// Call initializeWorker early, but it's safe to call multiple times
initializeWorker();

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(async (message) => {
  // Ensure the message is intended for the offscreen document
  if (message.target !== 'offscreen') {
    return;
  }

  switch (message.type) {
    case 'start-recording':
      console.log("Offscreen: Received start-recording message", message.payload);
      await startRecording(message.payload);
      break;
    case 'stop-recording':
      console.log("Offscreen: Received stop-recording message");
      await stopRecording();
      break;
    default:
      console.warn(`Offscreen: Received unknown message type: ${message.type}`);
  }
});

async function startRecording(payload) {
  // --- Remove recorder state check --- 
  // if (recorder?.state === 'recording') {
  //   console.warn("Offscreen: Recording is already in progress.");
  //   return;
  // }
  // --- End Remove recorder state check ---

  if (!payload || !payload.streamId || !payload.captureType) {
     console.error("Offscreen: Missing streamId or captureType in start payload.");
     sendMessageToBackground({ type: 'offscreen-error', payload: { error: 'Missing start parameters' } });
     return;
  }

  const { streamId, captureType } = payload;
  const mediaSource = captureType === 'tab' ? 'tab' : 'desktop';

  console.log(`Offscreen: Requesting media for ${captureType} with streamId: ${streamId}`);

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: mediaSource,
          chromeMediaSourceId: streamId,
        },
      },
      video: {
        mandatory: {
          chromeMediaSource: mediaSource,
          chromeMediaSourceId: streamId,
          // Consider adding quality constraints if needed
          // maxWidth: 1920,
          // maxHeight: 1080,
          // maxFrameRate: 30,
        },
      },
    });

    console.log("Offscreen: Media stream obtained successfully.");

    // --- Start Preview Generation ---
    await startPreview(mediaStream);

    // Ensure worker is initialized if it failed earlier or wasn't ready
    initializeWorker();

    // Handle stream ending unexpectedly (e.g., user stops sharing)
    mediaStream.addEventListener('inactive', () => {
      console.warn('Offscreen: Media stream became inactive. Triggering stop.');
      // Don't send an error, just trigger the normal stop sequence
      stopRecording(); // This will eventually lead to 'offscreen-recording-stopped'
    });

    // Inform background script recording has successfully started (Now means stream is active)
    sendMessageToBackground({ type: 'offscreen-recording-started' });

  } catch (error) {
    console.error("Offscreen: Error starting stream capture:", error); // Updated log message
    sendMessageToBackground({ type: 'offscreen-error', payload: { error: `Failed to get media: ${error.message}` } });
    stopPreview(); // Ensure preview stops on error
    // Clean up any partial state
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    // recorder = null; // No recorder to nullify
  }
}

async function stopRecording() {
  console.log("Offscreen: stopRecording called.");
  stopPreview(); // Ensure preview loop and worker are stopped first

  // --- Simplified stop logic: Stop stream tracks directly --- 
  if (mediaStream) {
      mediaStream.getTracks().forEach(track => track.stop());
      console.log("Offscreen: Media stream tracks stopped.");
      mediaStream = null;
  }
  // No recorder to check or stop
  // --- End simplified stop logic ---

  // Send stopped message to background
  sendMessageToBackground({ type: 'offscreen-recording-stopped' });
  
  // Close the offscreen document after a short delay
  console.log("Offscreen: Scheduling close.");
  setTimeout(() => {
      console.log("Offscreen: Closing window.");
      window.close();
  }, 500);
}

// --- NEW: Preview Generation Logic ---

async function startPreview(stream) {
    console.log("Offscreen: startPreview called.");
    if (!stream || !stream.active || stream.getVideoTracks().length === 0) {
        console.warn("Offscreen: Cannot start preview, invalid stream.");
        return;
    }

    try {
        // --- Keep Awake Audio Start ---
        if (!audioContext) {
            try {
                audioContext = new AudioContext();
                oscillator = audioContext.createOscillator();
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(20, audioContext.currentTime); // Very low freq
                const gainNode = audioContext.createGain();
                gainNode.gain.setValueAtTime(0, audioContext.currentTime); // Muted gain
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                oscillator.start();
                console.log("Offscreen: Silent AudioContext started to keep document awake.");
            } catch (audioError) {
                console.warn("Offscreen: Could not start silent AudioContext:", audioError);
                audioContext = null; // Ensure it's null if failed
                oscillator = null;
            }
        }
        // --- End Keep Awake Audio Start ---

        previewCanvas = document.getElementById('preview-canvas');
        if (!previewCanvas) {
            console.error("Offscreen: Preview canvas element not found!");
            return;
        }
        console.log("Offscreen: Preview canvas found."); // Log canvas found
        previewCanvasCtx = previewCanvas.getContext('2d');

        previewVideoElement = document.createElement('video');
        previewVideoElement.style.display = 'none';
        previewVideoElement.muted = true;
        previewVideoElement.srcObject = stream;

        previewVideoElement.onloadedmetadata = () => {
             console.log("Offscreen: Video metadata loaded."); // Log metadata load
             previewCanvas.width = previewVideoElement.videoWidth;
             previewCanvas.height = previewVideoElement.videoHeight;
             console.log(`Offscreen: Preview canvas resized to ${previewCanvas.width}x${previewCanvas.height}`);
        };
        previewVideoElement.oncanplay = async () => {
            try {
                await previewVideoElement.play();
                console.log("Offscreen: Preview video element playing.");

                // Start the frame grabbing loop using setInterval
                if (!previewIntervalId) { // Prevent starting multiple intervals
                   const intervalMs = 1000 / PREVIEW_FRAME_RATE;
                   previewIntervalId = setInterval(grabFrame, intervalMs);
                   console.log(`Offscreen: setInterval loop started (Interval: ${intervalMs.toFixed(0)}ms).`);
                }
            } catch (playError) {
                 console.error("Offscreen: Error playing preview video:", playError);
                 stopPreview();
            }
        };
        previewVideoElement.onerror = (e) => {
            console.error("Offscreen: Preview video element error:", e);
            stopPreview();
        };

        // Add video element to body to ensure it's processed (though hidden)
        document.body.appendChild(previewVideoElement);

    } catch (error) {
        console.error("Offscreen: Error setting up preview:", error);
        stopPreview(); // Calls audio context stop
    }
}

function stopPreview() {
    console.log("Offscreen: stopPreview called.");
    // Stop Interval
    if (previewIntervalId) {
        clearInterval(previewIntervalId);
        previewIntervalId = null;
        console.log("Offscreen: Preview interval cleared.");
    }

    // --- Keep Awake Audio Stop ---
    if (oscillator) {
        try {
            oscillator.stop();
        } catch (e) { /* Ignore error if already stopped */ }
        oscillator = null;
    }
    if (audioContext) {
        try {
            audioContext.close(); // Release audio resources
            console.log("Offscreen: Silent AudioContext closed.");
        } catch (e) { /* Ignore error if already closed */ }
        audioContext = null;
    }
     // --- End Keep Awake Audio Stop ---

    // Terminate the worker when stopping preview/recording
    if (onnxWorker) {
        onnxWorker.terminate();
        onnxWorker = null;
        console.log("Offscreen: ONNX Worker terminated.");
    }

    // Stop and clear video element
    if (previewVideoElement) {
        previewVideoElement.pause();
        previewVideoElement.srcObject = null;
        if (previewVideoElement.parentNode) { // Remove from DOM if added
            previewVideoElement.parentNode.removeChild(previewVideoElement);
        }
        previewVideoElement = null;
    }
    // Clear canvas context
    previewCanvas = null;
    previewCanvasCtx = null;
}

let frameCounter = 0; 
let lastFrameSendTime = 0; // Keep throttling within interval callback
function grabFrame() {
    frameCounter++;
    // console.log(`Offscreen: grabFrame: Called (Count: ${frameCounter})`); // Can be noisy

    // Restore checks and logic
    if (!previewVideoElement || previewVideoElement.paused || previewVideoElement.ended || !previewCanvasCtx) {
        console.log("Offscreen: grabFrame: Stopping condition met (inside interval).", {
            hasVideo: !!previewVideoElement,
            paused: previewVideoElement?.paused,
            ended: previewVideoElement?.ended,
            hasCtx: !!previewCanvasCtx
        });
        stopPreview(); // This will clear the interval
        return;
    }

    // No need for manual time check/throttling here - setInterval handles the rate.
    // const now = performance.now();
    // const elapsed = now - lastFrameSendTime;
    // const frameInterval = 1000 / PREVIEW_FRAME_RATE;
    // if (elapsed >= frameInterval) { ... }

    try {
        previewCanvasCtx.drawImage(previewVideoElement, 0, 0, previewCanvas.width, previewCanvas.height);
        // console.log("Offscreen: grabFrame: drawImage successful."); // Can be noisy
        const frameDataUrl = previewCanvas.toDataURL('image/jpeg', PREVIEW_QUALITY);
        sendMessageToBackground({
            type: 'preview-frame',
            payload: { frameDataUrl: frameDataUrl }
        });

        // --- Send Frame Data to Worker (Throttled) ---
        const now = performance.now();
        if (onnxWorker && now - lastFrameSentToWorker >= WORKER_PROCESSING_INTERVAL_MS) {
            lastFrameSentToWorker = now;
            // console.log("Offscreen: Sending data to worker.");
            // Get ImageData from the canvas
            const imageData = previewCanvasCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
            // Send ImageData to the worker, transferring the buffer
            onnxWorker.postMessage({ type: 'process-frame', payload: imageData }, [imageData.data.buffer]);
        }

    } catch (error) {
        console.error("Offscreen: grabFrame: Error during draw/send:", error);
        stopPreview(); // Stop interval on error
        return;
    }

    // No need to request next frame - setInterval handles looping
    // rafId = requestAnimationFrame(grabFrame);
}

// --- End Preview Generation Logic ---

function sendMessageToBackground(message) {
  // console.log("Offscreen: Sending message to background:", message.type);
  chrome.runtime.sendMessage(message).catch(error => {
      // This often happens if the background script context is invalidated (e.g., extension update/reload)
      // Or if the offscreen document is closing faster than the message can be sent.
      console.warn(`Offscreen: Error sending message type ${message.type} to background:`, error.message);
  });
}

// --- NEW: Function to send messages to content scripts ---
async function sendMessageToContentScript(message) {
    try {
        // Find active tab where the recording might be happening or UI is shown
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab && activeTab.id) {
             // console.log(`Offscreen: Sending message to content script in tab ${activeTab.id}:`, message.type);
             chrome.tabs.sendMessage(activeTab.id, message);
        } else {
             console.warn("Offscreen: Could not find active tab to send message to content script.");
        }
    } catch (error) {
        console.error("Offscreen: Error sending message to content script:", error);
    }
}

console.log("Offscreen script loaded and listener added.");
// Initialize worker on load
initializeWorker();