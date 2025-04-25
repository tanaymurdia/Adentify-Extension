console.log("ONNX Worker: Script loaded.");

// Import ONNX Runtime Web from locally copied file
importScripts('ort.min.js'); 

// --- Global variables ---
let ortSession = null;
// Smarter temporal smoothing: buffer + hysteresis thresholds
let scoreBuffer = [];
const BUFFER_SIZE = 5;         // Number of recent frames to average
const UPPER_THRESHOLD = 0.6;   // Threshold to enter Basketball state
const LOWER_THRESHOLD = 0.4;   // Threshold to exit Basketball state
let lastState = null;          // Previous classification state
const modelPath = "models/hypernetwork_basketball_classifier_quantized.onnx"; // <<<--- Using the actual model path
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
        // console.warn("ONNX Worker: Received message, but model is not loaded. Ignoring."); // Can be noisy
        return; 
    }

    if (event.data && event.data.type === 'processFrame') {
        // console.log("ONNX Worker: Received frame data."); // Can be noisy
        console.time("inference_cycle"); // Time the full cycle

        // 1. Preprocess
        const tensor = await preprocessImageData(event.data.frameData);
        if (!tensor) return; // Preprocessing failed

        try {
            // 2. Prepare feeds
            const inputName = ortSession.inputNames[0];
            const feeds = {};
            feeds[inputName] = tensor;
            // console.log(`ONNX Worker: Running inference with input name: ${inputName}`); // Can be noisy

            // 3. Run inference
            console.time("inference_run");
            const results = await ortSession.run(feeds);
            console.timeEnd("inference_run");

            // 4. Postprocess results
            const outputName = ortSession.outputNames[0];
            const outputTensor = results[outputName];
            
            // Output shape is likely [1, 1], data is Float32Array with one element
            const score = outputTensor.data[0];

            // Update rolling buffer
            scoreBuffer.push(score);
            if (scoreBuffer.length > BUFFER_SIZE) {
                scoreBuffer.shift();
            }

            // Compute average score over buffer
            const averageScore = scoreBuffer.reduce((a, b) => a + b, 0) / scoreBuffer.length;

            // Hysteresis-based state transition
            let newState;
            if (lastState === null) {
                newState = averageScore > UPPER_THRESHOLD;
            } else if (!lastState && averageScore > UPPER_THRESHOLD) {
                newState = true;
            } else if (lastState && averageScore < LOWER_THRESHOLD) {
                newState = false;
            } else {
                newState = lastState;
            }
            lastState = newState;

            const prediction = newState ? "Basketball Detected" : "No Basketball";
            // console.log(`Score: ${score.toFixed(4)}, Prediction: ${prediction}`); // Log score and result

            // 5. Send prediction back
            self.postMessage({
                type: 'predictionResult',
                result: prediction
            });

            // *** ADD LOGGING HERE ***
            console.log('ONNX Raw Output:', results);
            console.log('ONNX Output Tensor Data:', outputTensor.data);

            console.timeEnd("inference_cycle"); // End full cycle timing

        } catch (error) {
            console.error("ONNX Worker: Error during inference or postprocessing:", error);
            self.postMessage({ type: 'workerError', error: `Inference error: ${error.message}` });
            console.timeEnd("inference_cycle"); // Ensure timer ends on error
        }

    } else if (event.data) { // Avoid warning for potentially empty/internal messages
        console.warn("ONNX Worker: Received unknown message format:", event.data);
    }
};

// --- Error Handler ---
self.onerror = (error) => {
    console.error("ONNX Worker: Uncaught error occurred:", error);
    self.postMessage({ type: 'workerError', error: `Worker uncaught error: ${error.message}` });
};

// --- Initial Setup ---
console.log("ONNX Worker: Ready. Starting model load...");
loadModel(); // Start loading the actual model 