console.log("ONNX Worker: Script loaded.");

// Import ONNX Runtime Web from locally copied file
importScripts('ort.min.js'); 

// --- Global variables ---
let ortSession = null;
// Advanced temporal classification with buffer and voting
const SMOOTHING_ALPHA = 0.3;   // EMA smoothing factor (0-1) - increased for faster response
let emaScore = null;           // Exponential moving average state
const UPPER_THRESHOLD = 0.6;   // Threshold to enter Basketball state
const LOWER_THRESHOLD = 0.4;   // Threshold to exit Basketball state
let lastState = null;          // Previous classification state

// New temporal classification variables - optimized for speed
const PREDICTION_HISTORY_SIZE = 5;   // Reduced history size for faster response
const MAJORITY_THRESHOLD = 0.6;      // Lower threshold for faster state changes (60% agreement)
const MIN_CONFIDENCE_FOR_QUICK_CHANGE = 0.8; // Immediate state change at high confidence
const AD_CLIP_PATTERN_LENGTH = 2;    // Frames to determine commercial clip pattern
let predictionHistory = [];          // Buffer of raw prediction scores
let classificationHistory = [];      // Buffer of classification decisions
let lastHighConfidenceTime = 0;      // Track high-confidence detections for quicker responses

const modelPath = "models/hypernetwork_basketball_classifier_quantized.onnx";
const TARGET_WIDTH = 224;
const TARGET_HEIGHT = 224;

// --- Initialize ONNX Runtime and Load Model ---
async function loadModel() {
    console.log("ONNX Worker: Initializing ONNX Runtime...");
    try {
        // Point to locally copied WASM files
        ort.env.wasm.wasmPaths = './wasm/'; 
        
        // ---> Force basic non-threaded, non-SIMD WASM backend <--- 
        ort.env.wasm.numThreads = 1;
        // ort.env.wasm.simd = false; // REMOVED - Deprecated and ignored
        console.log("ONNX Worker: Forcing single-threaded WASM backend."); // Updated log message
        
        console.log(`ONNX Worker: Attempting to load model from: ${modelPath}`);
        ortSession = await ort.InferenceSession.create(modelPath, {
            executionProviders: ['wasm'], // Force only WASM provider
            graphOptimizationLevel: 'all' // Optional: Keep optimization
        });
        console.log("ONNX Worker: Model loaded successfully!");
        console.log("Model inputs:", ortSession.inputNames);
        console.log("Model outputs:", ortSession.outputNames);

    } catch (error) {
        console.error(`ONNX Worker: Error loading ONNX model (${modelPath}):`, error);
        self.postMessage({ type: 'workerError', error: `Failed to load model: ${error.message}` });
        ortSession = null; // Ensure session is null if loading failed
    }
}

// --- Preprocessing Function ---
async function preprocessImageData(imageData) {
    console.time("preprocess"); // Start timing preprocessing
    try {
        // 1. Create ImageBitmap for efficient resizing
        const bitmap = await createImageBitmap(imageData);

        // 2. Use OffscreenCanvas for resizing
        const offscreenCanvas = new OffscreenCanvas(TARGET_WIDTH, TARGET_HEIGHT);
        const ctx = offscreenCanvas.getContext('2d');
        if (!ctx) {
            throw new Error("Failed to get 2D context from OffscreenCanvas");
        }

        // 3. Draw (and resize) the bitmap onto the canvas
        ctx.drawImage(bitmap, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        // Close the bitmap to free memory
        bitmap.close(); 

        // 4. Get the resized image data
        const resizedImageData = ctx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);

        // 5. Prepare Float32Array for ONNX input (Batch=1, H, W, C=3)
        const tensorData = new Float32Array(1 * TARGET_HEIGHT * TARGET_WIDTH * 3);
        const data = resizedImageData.data; // RGBA array

        // 6. Iterate through RGBA data and copy RGB to Float32Array (maintaining 0-255 range)
        let tensorIndex = 0;
        for (let i = 0; i < data.length; i += 4) {
            tensorData[tensorIndex++] = data[i];     // R
            tensorData[tensorIndex++] = data[i + 1]; // G
            tensorData[tensorIndex++] = data[i + 2]; // B
            // Skip A (data[i + 3])
        }

        // 7. Create the ONNX Tensor
        const dims = [1, TARGET_HEIGHT, TARGET_WIDTH, 3]; // N H W C format
        const tensor = new ort.Tensor('float32', tensorData, dims);
        console.timeEnd("preprocess"); // End timing preprocessing
        return tensor;

    } catch (error) {
        console.error("ONNX Worker: Error during preprocessing:", error);
        console.timeEnd("preprocess"); // Ensure timer ends on error
        self.postMessage({ type: 'workerError', error: `Preprocessing error: ${error.message}` });
        return null;
    }
}

// --- Message Handler ---
self.onmessage = async (event) => {
    if (!ortSession) {
        return; 
    }

    if (event.data && event.data.type === 'processFrame') {
        console.time("inference_cycle");

        // 1. Preprocess
        const tensor = await preprocessImageData(event.data.frameData);
        if (!tensor) return;

        try {
            // 2. Prepare feeds
            const inputName = ortSession.inputNames[0];
            const feeds = {};
            feeds[inputName] = tensor;

            // 3. Run inference
            console.time("inference_run");
            const results = await ortSession.run(feeds);
            console.timeEnd("inference_run");

            // 4. Postprocess results
            const outputName = ortSession.outputNames[0];
            const outputTensor = results[outputName];
            
            // Raw score from model output
            const rawScore = outputTensor.data[0];
            const currentTime = Date.now();
            
            // Add to prediction history
            predictionHistory.push(rawScore);
            if (predictionHistory.length > PREDICTION_HISTORY_SIZE) {
                predictionHistory.shift();
            }
            
            // Update EMA for smoothing
            emaScore = emaScore === null ? rawScore : SMOOTHING_ALPHA * rawScore + (1 - SMOOTHING_ALPHA) * emaScore;
            
            // Calculate variance in recent predictions to detect stable signals
            const variance = calculateVariance(predictionHistory);
            const isStableSignal = variance < 0.03; // Low variance indicates stable signal
            
            // Detect commercial patterns: short bursts of basketball in non-basketball content
            const hasCommercialPattern = detectCommercialPattern(predictionHistory);
            
            // Confidence level (combines raw score with stability)
            const confidenceLevel = calculateConfidence(rawScore, isStableSignal, hasCommercialPattern);
            
            // Faster classification (immediate response for high confidence)
            let newState;
            
            // High confidence, fast path classification
            if (confidenceLevel > MIN_CONFIDENCE_FOR_QUICK_CHANGE) {
                const highConfidenceValue = rawScore > UPPER_THRESHOLD;
                
                // Record the time of high confidence detection
                lastHighConfidenceTime = currentTime;
                
                // If high confidence and no commercial pattern, accept immediately
                if (!hasCommercialPattern) {
                    newState = highConfidenceValue;
                    // Log fast classification
                    console.log(`ONNX Worker: Fast classification due to high confidence (${confidenceLevel.toFixed(2)})`);
                } else {
                    // Commercial pattern detected, use standard approach
                    newState = determineStateWithHistory(rawScore);
                }
            } 
            // Moderate confidence
            else {
                // Standard approach with history-based classification
                newState = determineStateWithHistory(rawScore);
                
                // Handle quick transitions for returning content
                if (currentTime - lastHighConfidenceTime < 2000) {
                    // Within 2 seconds of high confidence, bias toward that detection
                    const recentAverage = calculateAverageScore(predictionHistory);
                    if (Math.abs(recentAverage - UPPER_THRESHOLD) < 0.1) {
                        // Close to threshold, use recent high confidence
                        newState = lastState;
                    }
                }
            }
            
            // Update state
            lastState = newState;
            const prediction = newState ? "Basketball Detected" : "No Basketball";
            
            // Enhanced logging for debugging temporal classification
            console.log(`Raw: ${rawScore.toFixed(3)}, EMA: ${emaScore.toFixed(3)}, ` +
                      `Variance: ${variance.toFixed(4)}, ` +
                      `Confidence: ${confidenceLevel.toFixed(2)}, ` +
                      `CommercialPattern: ${hasCommercialPattern}, ` +
                      `Prediction: ${prediction}`);

            // 5. Send prediction back
            self.postMessage({
                type: 'predictionResult',
                result: prediction
            });

            console.timeEnd("inference_cycle");

        } catch (error) {
            console.error("ONNX Worker: Error during inference or postprocessing:", error);
            self.postMessage({ type: 'workerError', error: `Inference error: ${error.message}` });
            console.timeEnd("inference_cycle");
        }
    } else if (event.data) {
        console.warn("ONNX Worker: Received unknown message format:", event.data);
    }
};

// Helper function to calculate variance of an array of values
function calculateVariance(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
}

// Helper function to calculate average score
function calculateAverageScore(scores) {
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

// Function to detect patterns typical of commercial clips
function detectCommercialPattern(scores) {
    if (scores.length < AD_CLIP_PATTERN_LENGTH + 1) return false;
    
    // Get the last N+1 scores
    const recentScores = scores.slice(-AD_CLIP_PATTERN_LENGTH - 1);
    
    // Patterns to detect:
    // 1. Sudden spike then drop (basketball clip in commercial)
    // 2. Sudden drop then rise (commercial break in basketball)
    
    let hasPattern = false;
    
    // Check for spike pattern (low -> high -> low)
    if (recentScores[0] < 0.3 && 
        recentScores[1] > 0.7 && 
        recentScores[2] < 0.3) {
        hasPattern = true;
    }
    
    // Check for dip pattern (high -> low -> high)
    if (recentScores[0] > 0.7 && 
        recentScores[1] < 0.3 && 
        recentScores[2] > 0.7) {
        hasPattern = true;
    }
    
    return hasPattern;
}

// Calculate confidence level based on score and stability
function calculateConfidence(score, isStable, hasCommercialPattern) {
    // Base confidence is higher the further from threshold
    let confidence = 0;
    
    if (score > UPPER_THRESHOLD) {
        confidence = 0.5 + (score - UPPER_THRESHOLD) * 2; // Scale up to 1.0
    } else if (score < LOWER_THRESHOLD) {
        confidence = 0.5 + (LOWER_THRESHOLD - score) * 2; // Scale up to 1.0
    } else {
        // In the threshold zone, lower confidence
        confidence = 0.3;
    }
    
    // Boost confidence if signal is stable
    if (isStable) {
        confidence += 0.15;
    }
    
    // Lower confidence if commercial pattern detected
    if (hasCommercialPattern) {
        confidence *= 0.6;
    }
    
    // Cap at 1.0
    return Math.min(confidence, 1.0);
}

// Determine state using history-based approach (used for moderate confidence cases)
function determineStateWithHistory(currentScore) {
    // Current classification based on thresholds
    let currentClassification;
    if (currentScore > UPPER_THRESHOLD) {
        currentClassification = true; // Basketball
    } else if (currentScore < LOWER_THRESHOLD) {
        currentClassification = false; // Not basketball
    } else {
        // In hysteresis zone, maintain previous state
        currentClassification = lastState !== null ? lastState : false;
    }
    
    // Add to classification history
    classificationHistory.push(currentClassification);
    if (classificationHistory.length > PREDICTION_HISTORY_SIZE) {
        classificationHistory.shift();
    }
    
    // Count true (basketball) classifications in history
    const basketballCount = classificationHistory.filter(c => c === true).length;
    const basketballRatio = basketballCount / classificationHistory.length;
    
    // Determine state based on majority voting
    if (basketballRatio > MAJORITY_THRESHOLD) {
        return true;
    } else if (basketballRatio < (1 - MAJORITY_THRESHOLD)) {
        return false;
    } else {
        // Not enough consensus, maintain previous state
        return lastState !== null ? lastState : false;
    }
}

// --- Error Handler ---
self.onerror = (error) => {
    console.error("ONNX Worker: Uncaught error occurred:", error);
    self.postMessage({ type: 'workerError', error: `Worker uncaught error: ${error.message}` });
};

// --- Initial Setup ---
console.log("ONNX Worker: Ready. Starting model load...");
loadModel(); // Start loading the actual model 