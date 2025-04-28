let recorder = null;
let mediaStream = null; // Store the stream obtained from getUserMedia
let previewVideoElement = null; // Hidden video element to play the stream
let previewCanvas = null; // Hidden canvas for frame grabbing
let previewCanvasCtx = null;
let previewIntervalId = null; // ID for setInterval
let audioContext = null; // Keep document awake
let oscillator = null; // Silent audio source
let onnxWorker = null; // Reference to the worker
let isStopping = false; // Flag to prevent multiple stop attempts
let capturedTabId = null; // --- ADDED: Store the tab ID ---

// Mime type configuration - adjust as needed
const mimeType = 'video/webm;codecs=vp9';
const CHUNK_TIMESLICE_MS = 1000; // Send chunks every 1 second
const PREVIEW_FRAME_RATE = 1; // Lower frame rate to ~1 FPS for worker processing
const PREVIEW_QUALITY = 0.6; // JPEG quality for preview frames (0.0 to 1.0)
const INFERENCE_THROTTLE_MS = 200; // ms delay between inference frames to throttle CPU usage

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
  if (recorder?.state === 'recording') {
    console.warn("Offscreen: Recording is already in progress.");
    return;
  }

  // Reset stopping flag when starting a new recording
  isStopping = false;

  // --- ADDED: Check for and store tabId ---
  if (!payload || !payload.streamId || !payload.captureType || !payload.tabId) {
     console.error("Offscreen: Missing streamId, captureType, or tabId in start payload.");
     sendMessageToBackground({ type: 'offscreen-error', payload: { error: 'Missing start parameters (including tabId)' } });
     return;
  }
  capturedTabId = payload.tabId; // Store the tabId
  console.log(`Offscreen: Associated with tab ID: ${capturedTabId}`);
  // --- END ADDITION ---

  const { streamId, captureType } = payload;
  const mediaSource = captureType === 'tab' ? 'tab' : 'desktop';

  console.log(`Offscreen: Requesting media for ${captureType} with streamId: ${streamId}`);

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        mandatory: {
          chromeMediaSource: mediaSource,
          chromeMediaSourceId: streamId,
        },
      },
    });

    console.log("Offscreen: Media stream obtained successfully.");

    // --- Start Preview Generation ---
    await startPreview(mediaStream);

    // Handle stream ending unexpectedly (e.g., user stops sharing)
    mediaStream.addEventListener('inactive', () => {
      console.log('Offscreen: Media stream became inactive. Triggering stop.');
      // Don't send an error, just trigger the normal stop sequence
      stopRecording(); // This will eventually lead to 'offscreen-recording-stopped'
    });

    // Start the MediaRecorder
    recorder = new MediaRecorder(mediaStream, { mimeType: mimeType });

    recorder.ondataavailable = (event) => {
      // REMOVED - No longer sending chunks
      // if (event.data.size > 0) {
      //   sendMessageToBackground({
      //       type: 'new-chunk',
      //       payload: { chunk: event.data }
      //   });
      // }
      // console.log('Offscreen: Chunk available, discarding.'); // Optional log
    };

    recorder.onstop = () => {
      console.log("Offscreen: MediaRecorder stopped.");
      stopPreview();

      if (mediaStream) {
          mediaStream.getTracks().forEach(track => track.stop());
          console.log("Offscreen: Media stream tracks stopped.");
          mediaStream = null;
      }
      recorder = null;

      // --- MOVED & REORDERED: Send message AFTER cleanup ---
      sendMessageToBackground({ type: 'offscreen-recording-stopped' });
      console.log("Offscreen: Sent 'offscreen-recording-stopped' after cleanup.");
      // --- END MOVE ---

      // Close the offscreen document after a short delay
      setTimeout(() => window.close(), 500);
    };

    recorder.onerror = (event) => {
        console.error("Offscreen: MediaRecorder error:", event.error);
        sendMessageToBackground({ type: 'offscreen-error', payload: { error: `MediaRecorder error: ${event.error.name || event.error}` } });
        stopRecording(); // Use the unified stop function, which now checks the flag
    };

    // Start recording, generating chunks periodically
    recorder.start(CHUNK_TIMESLICE_MS);
    console.log("Offscreen: MediaRecorder started.");

    // Inform background script recording has successfully started
    sendMessageToBackground({ type: 'offscreen-recording-started' });

    console.log("Offscreen: startRecording - Initializing ONNX Worker...");
    initializeWorker(); // Initialize worker when recording starts

  } catch (error) {
    console.error("Offscreen: Error starting recording:", error);
    sendMessageToBackground({ type: 'offscreen-error', payload: { error: `Failed to get media: ${error.message}` } });
    stopPreview(); // Ensure preview stops on error
    // Clean up any partial state
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    recorder = null;
  }
}

async function stopRecording() {
  // Prevent multiple stop attempts running concurrently
  if (isStopping) {
    console.log("Offscreen: stopRecording called, but already in the process of stopping.");
    return;
  }
  isStopping = true;
  console.log("Offscreen: Initiating stop sequence...");

  if (recorder && recorder.state !== 'inactive') {
    console.log("Offscreen: Stopping MediaRecorder...");
    recorder.stop(); // This triggers the 'onstop' event handler
  } else {
    console.warn("Offscreen: stopRecording called, but recorder is not active.");
    // Ensure tracks are stopped even if recorder state is weird
    if (mediaStream) {
        mediaStream.getTracks().forEach(track => track.stop());
        mediaStream = null;
    }
    // Send stopped message just in case the background script missed it
    sendMessageToBackground({ type: 'offscreen-recording-stopped' });
    // Close immediately if recorder wasn't active
    window.close();
  }
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
        previewCanvasCtx = previewCanvas.getContext('2d', { willReadFrequently: true });

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

                // Kick off the first inference frame (handshake scheduling)
                grabFrame();
                console.log("Offscreen: First inference frame triggered via handshake.");
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

    terminateWorker(); // Terminate worker when preview stops

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

    if (!previewVideoElement || previewVideoElement.paused || previewVideoElement.ended || !previewCanvasCtx || !onnxWorker) { // Added worker check
        console.log("Offscreen: grabFrame: Stopping condition met (inside interval).", {
            hasVideo: !!previewVideoElement,
            paused: previewVideoElement?.paused,
            ended: previewVideoElement?.ended,
            hasCtx: !!previewCanvasCtx,
            hasWorker: !!onnxWorker // Log worker state
        });
        stopPreview();
        return;
    }

    try {
        previewCanvasCtx.drawImage(previewVideoElement, 0, 0, previewCanvas.width, previewCanvas.height);
        // Get ImageData instead of DataURL for worker processing
        const imageData = previewCanvasCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);

        // Send ImageData to worker (ImageData is transferable)
        // console.log("Offscreen: grabFrame: Posting frame to worker..."); // Noisy
        onnxWorker.postMessage({
            type: 'processFrame',
            frameData: imageData
        });

        // Still send preview frame (optional, can be removed if worker handles display via content script)
        const frameDataUrl = previewCanvas.toDataURL('image/jpeg', PREVIEW_QUALITY);
        sendMessageToBackground({
            type: 'preview-frame',
            payload: { frameDataUrl: frameDataUrl }
        });

    } catch (error) {
        console.error("Offscreen: grabFrame: Error during draw/send:", error);
        stopPreview();
        return;
    }
}

// --- End Preview Generation Logic ---

// --- NEW: Worker Initialization ---
function initializeWorker() {
    if (onnxWorker) {
        console.log("Offscreen: Worker already initialized.");
        return;
    }
    try {
        // Assuming build process creates onnx_worker.bundle.js
        const workerUrl = chrome.runtime.getURL('onnx_worker.bundle.js');
        onnxWorker = new Worker(workerUrl);
        console.log("Offscreen: ONNX Worker created from:", workerUrl);

        onnxWorker.onmessage = (event) => {
            if (event.data?.type === 'predictionResult') {
                // Forward the prediction to the background script, renaming type to 'onnxPrediction'
                 sendMessageToBackground({
                    type: 'onnxPrediction',
                    payload: {
                         prediction: event.data.result, // Use 'result' from worker message
                         tabId: capturedTabId
                         }
                });
                // After receiving a result, schedule the next inference frame with throttle
                setTimeout(grabFrame, INFERENCE_THROTTLE_MS);
            } else if (event.data?.type === 'status') {
                console.log("Offscreen: ONNX Worker Status:", event.data.message);
            } else if (event.data && event.data.type === 'workerError') {
                 console.error("Offscreen: Received error message from worker:", event.data.error);
                 // Handle worker error appropriately (e.g., stop processing?)
            } else {
                console.warn("Offscreen: Received unknown message from worker:", event.data);
            }
        };

        onnxWorker.onerror = (error) => {
            console.error("Offscreen: ONNX Worker onerror event:", error);
            // Handle worker error (e.g., terminate and maybe try restarting?)
            terminateWorker();
        };

        onnxWorker.onmessageerror = (event) => {
             console.error("Offscreen: ONNX Worker onmessageerror event:", event);
        };

    } catch (error) {
        console.error("Offscreen: Failed to initialize ONNX Worker:", error);
        onnxWorker = null; // Ensure it's null if failed
    }
}

function terminateWorker() {
    if (onnxWorker) {
        console.log("Offscreen: Terminating ONNX Worker...");
        onnxWorker.terminate();
        onnxWorker = null;
    }
}

function sendMessageToBackground(message) {
  // console.log("Offscreen: Sending message to background:", message.type);
  chrome.runtime.sendMessage(message).catch(error => {
      // This often happens if the background script context is invalidated (e.g., extension update/reload)
      // Or if the offscreen document is closing faster than the message can be sent.
      console.warn(`Offscreen: Error sending message type ${message.type} to background:`, error.message);
  });
}

// Initial log
console.log("Offscreen document script loaded and ready.");