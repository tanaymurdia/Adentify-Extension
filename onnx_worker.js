console.log("ONNX Worker: Script loaded.");

// Import ONNX Runtime Web from locally copied file
importScripts('ort.min.js'); 

// --- Global variables ---
let ortSession = null;
const modelPath = "dummy_model.onnx"; // <<<--- IMPORTANT: Update this path if your model is elsewhere

// --- Initialize ONNX Runtime and Load Model ---
async function loadModel() {
    console.log("ONNX Worker: Initializing ONNX Runtime...");
    try {
        // Point to locally copied WASM files within the extension's dist/wasm/ directory
        ort.env.wasm.wasmPaths = './wasm/'; 
        console.log("ONNX Worker: Runtime initialized. Skipping model load (no model path provided).");

        // >>>>> Model Loading Skipped <<<<<
        // console.log(`ONNX Worker: Attempting to load model from: ${modelPath}`);
        // ortSession = await ort.InferenceSession.create(modelPath);
        // console.log("ONNX Worker: Model loaded successfully!");
        // >>>>> Model Loading Skipped <<<<<

        ortSession = null; // Ensure session remains null as no model is loaded

    } catch (error) {
        console.error("ONNX Worker: Error during ONNX Runtime initialization:", error);
        self.postMessage({ type: 'workerError', error: `Failed to initialize ONNX runtime: ${error.message}` });
        ortSession = null;
    }
}

// --- Message Handler ---
self.onmessage = async (event) => { // Make handler async if using await inside
    if (!ortSession) {
        console.warn("ONNX Worker: Received message, but model is not loaded. Ignoring.");
        return; // Don't process if model isn't ready
    }

    if (event.data && event.data.type === 'processFrame') {
        // console.log("ONNX Worker: Received frame data.");

        // --- TODO: Add actual ONNX inference logic here ---
        // 1. Preprocess event.data.frameData (ImageData) into the expected tensor format
        // 2. Create input feeds object: const feeds = { [ortSession.inputNames[0]]: tensorData };
        // 3. Run inference: const results = await ortSession.run(feeds);
        // 4. Postprocess results[ortSession.outputNames[0]] to get prediction
        // 5. Send prediction back

        // Simulate classification result for now
        const isBasketball = Math.random() > 0.5;
        const prediction = isBasketball ? 'Basketball Detected (Simulated)' : 'No Basketball (Simulated)';

        // console.log(`ONNX Worker: Prediction - ${prediction}`);

        // Send result back to the offscreen script
        self.postMessage({
            type: 'predictionResult',
            result: prediction
        });
    } else {
        console.warn("ONNX Worker: Received unknown message format:", event.data);
    }
};

// --- Error Handler ---
self.onerror = (error) => {
    console.error("ONNX Worker: Uncaught error occurred:", error);
    // Optionally notify the main thread about the error
    self.postMessage({ type: 'workerError', error: `Worker uncaught error: ${error.message}` });
};

// --- Initial Setup ---
console.log("ONNX Worker: Ready. Starting model load...");
loadModel(); // Start loading the model immediately when the worker is ready 