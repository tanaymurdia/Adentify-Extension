self.onmessage = async (event) => {
    // Check if the received payload is ImageData-like
    const frameData = event.data.payload;
    let isValidFrame = false;
    if (frameData && typeof frameData.width === 'number' && typeof frameData.height === 'number' && frameData.data instanceof Uint8ClampedArray) {
        // console.log(`Worker: Received valid frame data ${frameData.width}x${frameData.height}`);
        isValidFrame = true;
    } else {
        console.warn('Worker: Received invalid or missing frame data.', frameData);
    }

    // --- Simulate Processing (only if frame is valid) ---
    let result = "Processing..."; // Default result
    if (isValidFrame) {
        // Simulate model processing time
        await new Promise(resolve => setTimeout(resolve, 50)); // Simulate 50ms processing

        // Simulate model output
        const classifications = ["Basketball", "Not basketball"];
        result = classifications[Math.floor(Math.random() * classifications.length)];
    } else {
        result = "Invalid Frame";
    }
    // --- End Simulation ---

    // console.log('Worker sending result:', result);
    // Send the result back to the offscreen document
    self.postMessage({ type: 'classification-result', payload: result });
};

console.log('ONNX Worker loaded.'); 