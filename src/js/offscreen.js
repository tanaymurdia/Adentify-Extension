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

// Scene detection variables
let previousFrameData = null;
let sceneDetectionThreshold = 0.15; // Default threshold (15% difference)
let blockSize = 32; // Size of blocks for scene detection
let processingFrame = false; // Flag to prevent overlapping processing
let frameCounter = 0; // Counter for debugging
let previousHistogram = null; // Store color histogram for previous frame
let previousEdges = null; // Store edge information from previous frame
let frameHistory = []; // Store recent frame metrics for temporal analysis
const FRAME_HISTORY_LENGTH = 3; // Number of recent frames to analyze for patterns

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
    case 'update-scene-sensitivity':
      console.log("Offscreen: Updating scene detection sensitivity", message.payload);
      if (message.payload && typeof message.payload.threshold === 'number') {
        sceneDetectionThreshold = message.payload.threshold;
        console.log(`Offscreen: Scene detection threshold set to ${sceneDetectionThreshold.toFixed(4)}`);
      }
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
  
  // Update scene detection threshold if provided
  if (payload.sceneDetectionThreshold !== undefined) {
    sceneDetectionThreshold = payload.sceneDetectionThreshold;
    console.log(`Offscreen: Initial scene detection threshold set to ${sceneDetectionThreshold}`);
  }
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

                // Always grab the first frame regardless of scene detection
                // Note: grabFrame function is now properly defined
                grabFrame();
                console.log("Offscreen: First inference frame triggered directly.");
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
    
    // Reset scene detection variables
    previousFrameData = null;

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

let lastFrameSendTime = 0; // Keep throttling within interval callback

// New sports-optimized scene detection function
function detectSceneChange() {
    frameCounter++;

    if (!previewVideoElement || previewVideoElement.paused || previewVideoElement.ended || !previewCanvasCtx) {
        console.log("Offscreen: detectSceneChange: Stopping condition met.", {
            hasVideo: !!previewVideoElement,
            paused: previewVideoElement?.paused,
            ended: previewVideoElement?.ended,
            hasCtx: !!previewCanvasCtx
        });
        stopPreview();
        return false;
    }

    try {
        // Draw current frame to canvas
        previewCanvasCtx.drawImage(previewVideoElement, 0, 0, previewCanvas.width, previewCanvas.height);
        
        // Get current frame data
        const currentFrameData = previewCanvasCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
        
        // If we don't have a previous frame, store this one and return true to process first frame
        if (!previousFrameData) {
            console.log("Offscreen: First frame - no previous frame to compare");
            previousFrameData = currentFrameData;
            previousHistogram = calculateColorHistogram(currentFrameData);
            previousEdges = detectEdges(currentFrameData);
            return true;
        }
        
        // Multi-factor scene detection
        const metrics = calculateSceneChangeMetrics(currentFrameData, previousFrameData);
        
        // Update frame history for temporal analysis
        frameHistory.push(metrics);
        if (frameHistory.length > FRAME_HISTORY_LENGTH) {
            frameHistory.shift(); // Remove oldest frame
        }
        
        // Calculate combined score based on current metrics and frame history
        const score = calculateCombinedScore(metrics);
        
        // Log every frame score for debugging
        console.log(`Frame ${frameCounter}: Score = ${score.toFixed(4)}, Threshold = ${sceneDetectionThreshold.toFixed(4)}`);
        if (frameCounter % 5 === 0) {
            console.log(`Details: Motion=${metrics.motionScore.toFixed(3)}, Color=${metrics.colorScore.toFixed(3)}, Edge=${metrics.edgeScore.toFixed(3)}, Center=${metrics.centerScore.toFixed(3)}`);
        }

        // Store current frame data for next comparison
        previousFrameData = currentFrameData;
        previousHistogram = metrics.currentHistogram;
        previousEdges = metrics.currentEdges;
        
        // Determine if this is a scene change
        const isSceneChange = score > sceneDetectionThreshold;
        
        if (isSceneChange) {
            console.log(`%c🏀 BASKETBALL SCENE CHANGE! Score: ${score.toFixed(4)} > Threshold: ${sceneDetectionThreshold.toFixed(4)}`, 'background: #f60; color: white; font-weight: bold; padding: 4px 8px;');
            console.log(`Change factors: Motion=${metrics.motionScore.toFixed(3)}, Color=${metrics.colorScore.toFixed(3)}, Edge=${metrics.edgeScore.toFixed(3)}, Center=${metrics.centerScore.toFixed(3)}`);
        }
        
        return isSceneChange;
    } catch (error) {
        console.error("Offscreen: detectSceneChange: Error during frame comparison:", error);
        stopPreview();
        return false;
    }
}

// Calculate all scene change metrics between two frames
function calculateSceneChangeMetrics(currentFrame, previousFrame) {
    const metrics = {
        motionScore: 0,     // Motion vector analysis
        colorScore: 0,      // Color histogram difference
        edgeScore: 0,       // Edge difference
        centerScore: 0,     // Center region emphasis
        currentHistogram: null,
        currentEdges: null
    };
    
    // 1. Calculate block-based motion and center-weighted scores
    const { motionScore, centerScore } = analyzeMotionAndCenter(currentFrame, previousFrame);
    metrics.motionScore = motionScore;
    metrics.centerScore = centerScore;
    
    // 2. Calculate color histogram difference
    const currentHistogram = calculateColorHistogram(currentFrame);
    metrics.currentHistogram = currentHistogram;
    if (previousHistogram) {
        metrics.colorScore = compareHistograms(currentHistogram, previousHistogram);
    }
    
    // 3. Calculate edge differences
    const currentEdges = detectEdges(currentFrame);
    metrics.currentEdges = currentEdges;
    if (previousEdges) {
        metrics.edgeScore = compareEdges(currentEdges, previousEdges);
    }
    
    return metrics;
}

// Analyze motion vectors and center-weighted regions
function analyzeMotionAndCenter(currentFrame, previousFrame) {
    const width = currentFrame.width;
    const height = currentFrame.height;
    const currentData = currentFrame.data;
    const previousData = previousFrame.data;
    
    let totalMotion = 0;
    let centerMotion = 0;
    let blocksAnalyzed = 0;
    let centerBlocksAnalyzed = 0;
    
    const blocksX = Math.ceil(width / blockSize);
    const blocksY = Math.ceil(height / blockSize);
    
    // Center region boundaries (40% of the center area)
    const centerStartX = Math.floor(width * 0.3);
    const centerEndX = Math.floor(width * 0.7);
    const centerStartY = Math.floor(height * 0.3);
    const centerEndY = Math.floor(height * 0.7);
    
    // For each block, analyze motion
    for (let blockY = 0; blockY < blocksY; blockY++) {
        for (let blockX = 0; blockX < blocksX; blockX++) {
            const startX = blockX * blockSize;
            const startY = blockY * blockSize;
            const endX = Math.min(startX + blockSize, width);
            const endY = Math.min(startY + blockSize, height);
            
            // Calculate if this block is in the center region
            const isCenter = 
                startX >= centerStartX && endX <= centerEndX &&
                startY >= centerStartY && endY <= centerEndY;
            
            // Average colors and motion vectors for this block
            let currentR = 0, currentG = 0, currentB = 0;
            let previousR = 0, previousG = 0, previousB = 0;
            let pixelCount = 0;
            
            // Sample points within the block
            const stride = 4; // Sample every 4th pixel to reduce computation
            for (let y = startY; y < endY; y += stride) {
                for (let x = startX; x < endX; x += stride) {
                    const pixelIndex = (y * width + x) * 4;
                    
                    // Add RGB values
                    currentR += currentData[pixelIndex];
                    currentG += currentData[pixelIndex + 1];
                    currentB += currentData[pixelIndex + 2];
                    
                    previousR += previousData[pixelIndex];
                    previousG += previousData[pixelIndex + 1];
                    previousB += previousData[pixelIndex + 2];
                    
                    pixelCount++;
                }
            }
            
            // Calculate averages and motion
            if (pixelCount > 0) {
                currentR /= pixelCount;
                currentG /= pixelCount;
                currentB /= pixelCount;
                
                previousR /= pixelCount;
                previousG /= pixelCount;
                previousB /= pixelCount;
                
                // Motion score for this block
                const blockMotion = Math.sqrt(
                    Math.pow(currentR - previousR, 2) +
                    Math.pow(currentG - previousG, 2) +
                    Math.pow(currentB - previousB, 2)
                ) / 441.67; // Normalize (max possible = sqrt(3*255^2))
                
                totalMotion += blockMotion;
                blocksAnalyzed++;
                
                // If it's in the center region, add to center motion
                if (isCenter) {
                    centerMotion += blockMotion;
                    centerBlocksAnalyzed++;
                }
            }
        }
    }
    
    // Calculate overall motion and center-weighted motion
    const avgMotion = blocksAnalyzed > 0 ? totalMotion / blocksAnalyzed : 0;
    const avgCenterMotion = centerBlocksAnalyzed > 0 ? centerMotion / centerBlocksAnalyzed : 0;
    
    // Center regions are more important in sports - weight them higher
    return {
        motionScore: avgMotion,
        centerScore: avgCenterMotion
    };
}

// Calculate color histogram for the frame
function calculateColorHistogram(frame) {
    const data = frame.data;
    const histogram = {
        r: Array(8).fill(0),  // 8 bins for each channel
        g: Array(8).fill(0),
        b: Array(8).fill(0)
    };
    
    // Sample pixels (every 20th pixel to save computation)
    for (let i = 0; i < data.length; i += 80) {
        // Convert RGB to histogram bins (0-255 → 0-7)
        const r = Math.floor(data[i] / 32);      // R value (0-7)
        const g = Math.floor(data[i + 1] / 32);  // G value (0-7)
        const b = Math.floor(data[i + 2] / 32);  // B value (0-7)
        
        histogram.r[r]++;
        histogram.g[g]++;
        histogram.b[b]++;
    }
    
    // Normalize histogram
    const totalPixels = data.length / 80;
    for (let i = 0; i < 8; i++) {
        histogram.r[i] /= totalPixels;
        histogram.g[i] /= totalPixels;
        histogram.b[i] /= totalPixels;
    }
    
    return histogram;
}

// Compare two color histograms using chi-square distance
function compareHistograms(hist1, hist2) {
    let distance = 0;
    
    // Chi-square distance for each channel
    for (let i = 0; i < 8; i++) {
        if (hist1.r[i] + hist2.r[i] > 0) {
            distance += Math.pow(hist1.r[i] - hist2.r[i], 2) / (hist1.r[i] + hist2.r[i]);
        }
        if (hist1.g[i] + hist2.g[i] > 0) {
            distance += Math.pow(hist1.g[i] - hist2.g[i], 2) / (hist1.g[i] + hist2.g[i]);
        }
        if (hist1.b[i] + hist2.b[i] > 0) {
            distance += Math.pow(hist1.b[i] - hist2.b[i], 2) / (hist1.b[i] + hist2.b[i]);
        }
    }
    
    // Normalize to 0-1 range (max chi-square for 3 channels = 3)
    return Math.min(distance / 3, 1);
}

// Detect edges in the frame (very simplified edge detection)
function detectEdges(frame) {
    const width = frame.width;
    const height = frame.height;
    const data = frame.data;
    const edges = new Uint8Array(Math.ceil(width / 4) * Math.ceil(height / 4));
    
    // Simplified edge detection using brightness changes
    // Sample at low resolution (every 4th pixel) for performance
    for (let y = 4; y < height - 4; y += 4) {
        for (let x = 4; x < width - 4; x += 4) {
            const centerIdx = (y * width + x) * 4;
            const rightIdx = (y * width + (x + 4)) * 4;
            const bottomIdx = ((y + 4) * width + x) * 4;
            
            // Calculate brightness using luminance formula
            const centerBrightness = 
                0.299 * data[centerIdx] + 
                0.587 * data[centerIdx + 1] + 
                0.114 * data[centerIdx + 2];
            
            const rightBrightness = 
                0.299 * data[rightIdx] + 
                0.587 * data[rightIdx + 1] + 
                0.114 * data[rightIdx + 2];
            
            const bottomBrightness = 
                0.299 * data[bottomIdx] + 
                0.587 * data[bottomIdx + 1] + 
                0.114 * data[bottomIdx + 2];
            
            // Calculate horizontal and vertical gradients
            const horizGradient = Math.abs(centerBrightness - rightBrightness);
            const vertGradient = Math.abs(centerBrightness - bottomBrightness);
            
            // Combine gradients
            const gradient = Math.sqrt(horizGradient * horizGradient + vertGradient * vertGradient);
            
            // Store edge strength (threshold at 20 for binary edge)
            const edgeIdx = (Math.floor(y / 4) * Math.ceil(width / 4) + Math.floor(x / 4));
            edges[edgeIdx] = gradient > 20 ? 1 : 0;
        }
    }
    
    return edges;
}

// Compare edges between two frames
function compareEdges(edges1, edges2) {
    // Simple XOR comparison of edge maps
    let differentEdgePoints = 0;
    const totalEdgePoints = edges1.length;
    
    for (let i = 0; i < totalEdgePoints; i++) {
        if (edges1[i] !== edges2[i]) {
            differentEdgePoints++;
        }
    }
    
    return differentEdgePoints / totalEdgePoints;
}

// Calculate combined score from all metrics
function calculateCombinedScore(metrics) {
    // Weights for different metrics
    const weights = {
        motion: 0.35,     // General motion is important for sports
        color: 0.25,      // Color changes detect ads vs. game
        edge: 0.15,       // Edge changes help detect shot changes
        center: 0.25      // Center region is important in basketball
    };
    
    // Apply temporal analysis if we have enough history
    if (frameHistory.length >= FRAME_HISTORY_LENGTH) {
        // Calculate variance of motion over recent frames
        // High variance indicates camera cuts or significant action changes
        const motionValues = frameHistory.map(f => f.motionScore);
        const motionVariance = calculateVariance(motionValues);
        
        // Adjust motion score based on variance
        // If variance is high, we boost the scene change score
        const motionBoost = Math.min(motionVariance * 2, 0.5);
        metrics.motionScore = Math.min(metrics.motionScore + motionBoost, 1.0);
    }
    
    // Combined weighted score
    return (
        metrics.motionScore * weights.motion +
        metrics.colorScore * weights.color +
        metrics.edgeScore * weights.edge +
        metrics.centerScore * weights.center
    );
}

// Calculate variance
function calculateVariance(values) {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
}

// Add back the grabFrame function that was accidentally removed
function grabFrame() {
    if (!previewVideoElement || previewVideoElement.paused || previewVideoElement.ended || !previewCanvasCtx || !onnxWorker) {
        console.log("Offscreen: grabFrame: Stopping condition met.", {
            hasVideo: !!previewVideoElement,
            paused: previewVideoElement?.paused,
            ended: previewVideoElement?.ended,
            hasCtx: !!previewCanvasCtx,
            hasWorker: !!onnxWorker
        });
        stopPreview();
        return;
    }

    try {
        // Scene detection should have already drawn the current frame to canvas
        // Make sure we have a current frame
        previewCanvasCtx.drawImage(previewVideoElement, 0, 0, previewCanvas.width, previewCanvas.height);
        
        // Get ImageData for worker processing
        const imageData = previewCanvasCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);

        // Send ImageData to worker
        onnxWorker.postMessage({
            type: 'processFrame',
            frameData: imageData
        });

        // Send preview frame
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
                // Forward the prediction to the background script
                 sendMessageToBackground({
                    type: 'onnxPrediction',
                    payload: {
                        prediction: event.data.result,
                         tabId: capturedTabId
                         }
                });
                
                // Track whether this is the first prediction
                let isFirstPrediction = !window._hasProcessedFirstFrame;
                if (isFirstPrediction) {
                    window._hasProcessedFirstFrame = true;
                }
                
                // Prevent processing frames if we're already processing one
                if (processingFrame) {
                    return;
                }
                
                processingFrame = true;
                
                // Schedule next frame check with throttle
                setTimeout(() => {
                    try {
                        // First frame or scene change = process frame
                        if (isFirstPrediction || detectSceneChange()) {
                            // Make sure we have the grabFrame function
                            if (typeof grabFrame === 'function') {
                                grabFrame();
                            } else {
                                console.error("Offscreen: grabFrame function is not defined!");
                            }
                            processingFrame = false;
                        } else {
                            // If no scene change, check again after throttle delay
                            setTimeout(() => {
                                try {
                                    if (detectSceneChange()) {
                                        if (typeof grabFrame === 'function') {
                                            grabFrame();
                                        } else {
                                            console.error("Offscreen: grabFrame function is not defined!");
                                        }
                                        processingFrame = false;
                                    } else {
                                        // Continue checking for scene changes at regular intervals
                                        // Instead of calling onmessage directly, use the dedicated function
                                        processingFrame = false;
                                        if (onnxWorker) {
                                            setTimeout(checkForSceneChange, INFERENCE_THROTTLE_MS);
                                        }
                                    }
                                } catch (innerError) {
                                    console.error("Offscreen: Error in second scene detection check:", innerError);
                                    processingFrame = false;
                                }
                            }, INFERENCE_THROTTLE_MS);
                        }
                    } catch (outerError) {
                        console.error("Offscreen: Error in initial scene detection check:", outerError);
                        processingFrame = false;
                    }
                }, INFERENCE_THROTTLE_MS);
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

// Add a new function to continue the scene detection loop
function checkForSceneChange() {
    if (!onnxWorker || processingFrame || !previewVideoElement || previewVideoElement.paused) {
        return;
    }
    
    processingFrame = true;
    
    try {
        if (detectSceneChange()) {
            // Use the fully defined grabFrame function
            grabFrame();
            processingFrame = false;
        } else {
            processingFrame = false;
            // Schedule next check
            setTimeout(checkForSceneChange, INFERENCE_THROTTLE_MS);
        }
    } catch (error) {
        console.error("Offscreen: Error in checkForSceneChange:", error);
        processingFrame = false;
    }
}

// Initial log
console.log("Offscreen document script loaded and ready.");