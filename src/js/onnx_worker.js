console.log("ONNX Worker: Script loaded.");

importScripts('ort.min.js'); 
let ortSession = null;
const SMOOTHING_ALPHA = 0.3;
let emaScore = null;
const UPPER_THRESHOLD = 0.6;
const LOWER_THRESHOLD = 0.4;
let lastState = null;
const PREDICTION_HISTORY_SIZE = 5;
const MAJORITY_THRESHOLD = 0.6;
const MIN_CONFIDENCE_FOR_QUICK_CHANGE = 0.8;
const AD_CLIP_PATTERN_LENGTH = 2;
let predictionHistory = [];
let classificationHistory = [];
let lastHighConfidenceTime = 0;

const modelPath = "models/hypernetwork_basketball_classifier_quantized.onnx";
const TARGET_WIDTH = 224;
const TARGET_HEIGHT = 224;


async function loadModel() {
    console.log("ONNX Worker: Initializing ONNX Runtime...");
    try {
        ort.env.wasm.wasmPaths = './wasm/'; 
        
        ort.env.wasm.numThreads = 1;
        console.log("ONNX Worker: Forcing single-threaded WASM backend.");
        
        console.log(`ONNX Worker: Attempting to load model from: ${modelPath}`);
        ortSession = await ort.InferenceSession.create(modelPath, {
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        });
        console.log("ONNX Worker: Model loaded successfully!");
        console.log("Model inputs:", ortSession.inputNames);
        console.log("Model outputs:", ortSession.outputNames);

    } catch (error) {
        console.error(`ONNX Worker: Error loading ONNX model (${modelPath}):`, error);
        self.postMessage({ type: 'workerError', error: `Failed to load model: ${error.message}` });
        ortSession = null;
    }
}


async function preprocessImageData(imageData) {
    console.time("preprocess");
    try {
        const bitmap = await createImageBitmap(imageData);

        const offscreenCanvas = new OffscreenCanvas(TARGET_WIDTH, TARGET_HEIGHT);
        const ctx = offscreenCanvas.getContext('2d');
        if (!ctx) {
            throw new Error("Failed to get 2D context from OffscreenCanvas");
        }

        ctx.drawImage(bitmap, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
        bitmap.close(); 

        const resizedImageData = ctx.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT);

        const tensorData = new Float32Array(1 * TARGET_HEIGHT * TARGET_WIDTH * 3);
        const data = resizedImageData.data;

        let tensorIndex = 0;
        for (let i = 0; i < data.length; i += 4) {
            tensorData[tensorIndex++] = data[i];
            tensorData[tensorIndex++] = data[i + 1];
            tensorData[tensorIndex++] = data[i + 2];
        }

        const dims = [1, TARGET_HEIGHT, TARGET_WIDTH, 3];
        const tensor = new ort.Tensor('float32', tensorData, dims);
        console.timeEnd("preprocess");
        return tensor;

    } catch (error) {
        console.error("ONNX Worker: Error during preprocessing:", error);
        console.timeEnd("preprocess");
        self.postMessage({ type: 'workerError', error: `Preprocessing error: ${error.message}` });
        return null;
    }
}


self.onmessage = async (event) => {
    if (!ortSession) {
        return; 
    }

    if (event.data && event.data.type === 'processFrame') {
        console.time("inference_cycle");

        const tensor = await preprocessImageData(event.data.frameData);
        if (!tensor) return;

        try {
            const inputName = ortSession.inputNames[0];
            const feeds = {};
            feeds[inputName] = tensor;

            console.time("inference_run");
            const results = await ortSession.run(feeds);
            console.timeEnd("inference_run");

            const outputName = ortSession.outputNames[0];
            const outputTensor = results[outputName];
            
            const rawScore = outputTensor.data[0];
            const currentTime = Date.now();
            
            predictionHistory.push(rawScore);
            if (predictionHistory.length > PREDICTION_HISTORY_SIZE) {
                predictionHistory.shift();
            }
            
            emaScore = emaScore === null ? rawScore : SMOOTHING_ALPHA * rawScore + (1 - SMOOTHING_ALPHA) * emaScore;
            
            const variance = calculateVariance(predictionHistory);
            const isStableSignal = variance < 0.03;
            
            const hasCommercialPattern = detectCommercialPattern(predictionHistory);
            
            const confidenceLevel = calculateConfidence(rawScore, isStableSignal, hasCommercialPattern);
            
            let newState;
            
            if (confidenceLevel > MIN_CONFIDENCE_FOR_QUICK_CHANGE) {
                const highConfidenceValue = rawScore > UPPER_THRESHOLD;
                
                lastHighConfidenceTime = currentTime;
                
                if (!hasCommercialPattern) {
                    newState = highConfidenceValue;
                    console.log(`ONNX Worker: Fast classification due to high confidence (${confidenceLevel.toFixed(2)})`);
                } else {
                    newState = determineStateWithHistory(rawScore);
                }
            } 
            else {
                newState = determineStateWithHistory(rawScore);
                
                if (currentTime - lastHighConfidenceTime < 2000) {
                    const recentAverage = calculateAverageScore(predictionHistory);
                    if (Math.abs(recentAverage - UPPER_THRESHOLD) < 0.1) {
                        newState = lastState;
                    }
                }
            }
            
            lastState = newState;
            const prediction = newState ? "Basketball Detected" : "No Basketball";
            
            console.log(`Raw: ${rawScore.toFixed(3)}, EMA: ${emaScore.toFixed(3)}, ` +
                      `Variance: ${variance.toFixed(4)}, ` +
                      `Confidence: ${confidenceLevel.toFixed(2)}, ` +
                      `CommercialPattern: ${hasCommercialPattern}, ` +
                      `Prediction: ${prediction}`);

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

function calculateVariance(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
}

function calculateAverageScore(scores) {
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function detectCommercialPattern(scores) {
    if (scores.length < AD_CLIP_PATTERN_LENGTH + 1) return false;
    
    const recentScores = scores.slice(-AD_CLIP_PATTERN_LENGTH - 1);
    
    let hasPattern = false;
    
    if (recentScores[0] < 0.3 && 
        recentScores[1] > 0.7 && 
        recentScores[2] < 0.3) {
        hasPattern = true;
    }
    
    if (recentScores[0] > 0.7 && 
        recentScores[1] < 0.3 && 
        recentScores[2] > 0.7) {
        hasPattern = true;
    }
    
    return hasPattern;
}

function calculateConfidence(score, isStable, hasCommercialPattern) {
    let confidence = 0;
    
    if (score > UPPER_THRESHOLD) {
        confidence = 0.5 + (score - UPPER_THRESHOLD) * 2;
    } else if (score < LOWER_THRESHOLD) {
        confidence = 0.5 + (LOWER_THRESHOLD - score) * 2;
    } else {
        confidence = 0.3;
    }
    
    if (isStable) {
        confidence += 0.15;
    }
    
    if (hasCommercialPattern) {
        confidence *= 0.6;
    }
    
    return Math.min(confidence, 1.0);
}

function determineStateWithHistory(currentScore) {
    let currentClassification;
    if (currentScore > UPPER_THRESHOLD) {
        currentClassification = true;
    } else if (currentScore < LOWER_THRESHOLD) {
        currentClassification = false;
    } else {
        currentClassification = lastState !== null ? lastState : false;
    }
    
    classificationHistory.push(currentClassification);
    if (classificationHistory.length > PREDICTION_HISTORY_SIZE) {
        classificationHistory.shift();
    }
    
    const basketballCount = classificationHistory.filter(c => c === true).length;
    const basketballRatio = basketballCount / classificationHistory.length;
    
    if (basketballRatio > MAJORITY_THRESHOLD) {
        return true;
    } else if (basketballRatio < (1 - MAJORITY_THRESHOLD)) {
        return false;
    } else {
        return lastState !== null ? lastState : false;
    }
}


self.onerror = (error) => {
    console.error("ONNX Worker: Uncaught error occurred:", error);
    self.postMessage({ type: 'workerError', error: `Worker uncaught error: ${error.message}` });
};


console.log("ONNX Worker: Ready. Starting model load...");
loadModel();