// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const uploadButton = document.getElementById('uploadButton');
  const singleCaptureButton = document.getElementById('singleCaptureButton');
  const startCaptureButton = document.getElementById('startCaptureButton');
  const stopCaptureButton = document.getElementById('stopCaptureButton');
  const imageUpload = document.getElementById('imageUpload');
  const imagePreview = document.getElementById('imagePreview');
  const resultContainer = document.getElementById('resultContainer');
  const resultText = document.getElementById('resultText');
  const confidenceText = document.getElementById('confidenceText');
  const statusMessage = document.getElementById('statusMessage');
  const progressBar = document.getElementById('progressBar');
  const fpsCounter = document.getElementById('fpsCounter');
  const fpsValue = document.getElementById('fpsValue');

  // State flags
  let isProcessing = false;
  let ort = null;
  let isContinuousCapture = false;
  let lastResultTime = 0;
  
  // Performance tracking
  let frameCount = 0;
  let lastFpsUpdateTime = 0;
  let fpsUpdateInterval = 1000; // Update FPS every second

  // Notify background script that popup is open
  try {
    chrome.runtime.sendMessage({action: "popupOpened"}, function(response) {
      console.log("Popup opened, got state from background:", response);
      if (response) {
        if (response.isCapturing) {
          disableButtons();
          statusMessage.textContent = 'Capture in progress...';
          progressBar.style.width = '10%';
          isProcessing = true;
        }
        
        if (response.isContinuous) {
          isContinuousCapture = true;
          updateCaptureUI(true);
          
          // Show FPS counter if continuous capture is active
          frameCount = 0;
          lastFpsUpdateTime = Date.now();
          fpsValue.textContent = '0';
          fpsCounter.classList.remove('hidden');
        }
        
        // If there's a last result from background processing, display it
        if (response.lastResult) {
          displayBackgroundResult(response.lastResult);
        }
      }
    });
  } catch (err) {
    console.log("Error sending popupOpened message:", err);
  }

  // Register close event to notify background when popup closes
  window.addEventListener('unload', function() {
    try {
      // Using sync message to ensure it gets sent before popup closes
      chrome.runtime.sendMessage({action: "popupClosed"});
    } catch (err) {
      console.log("Error sending popupClosed message:", err);
    }
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Popup received message:", message.action);
    
    if (message.action === "screenshotCaptured") {
      // Process the captured screenshot
      handleCapturedImage(message.imageUrl, message.isContinuous);
      // Send immediate response to prevent async issues
      sendResponse({received: true});
      return false;
    } else if (message.action === "captureError") {
      // Handle capture error
      resetUI();
      statusMessage.textContent = `Capture error: ${message.error}`;
      sendResponse({received: true});
      return false;
    } else if (message.action === "captureStatusChanged") {
      // Update UI when capture status changes
      isContinuousCapture = message.isContinuous;
      updateCaptureUI(isContinuousCapture);
      sendResponse({received: true});
      return false;
    }
    return false;
  });

  // Event listeners
  uploadButton.addEventListener('click', () => {
    if (isProcessing) {
      statusMessage.textContent = 'Please wait for current processing to complete';
      return;
    }
    imageUpload.click();
  });

  singleCaptureButton.addEventListener('click', () => {
    if (isProcessing || isContinuousCapture) {
      statusMessage.textContent = 'Please wait for current processing to complete or stop continuous capture';
      return;
    }
    
    // Disable buttons and update UI
    disableButtons();
    
    statusMessage.textContent = 'Capturing tab...';
    progressBar.style.width = '10%';
    
    // Reset result display
    resultContainer.style.display = 'none';
    resultContainer.className = '';
    
    // Request the background script to capture the tab
    try {
      chrome.runtime.sendMessage({action: "singleCapture"}, (response) => {
        if (response && !response.success) {
          resetUI();
          statusMessage.textContent = `Capture failed: ${response.error || 'Unknown error'}`;
        }
      });
    } catch (err) {
      console.log("Error sending singleCapture message:", err);
      resetUI();
      statusMessage.textContent = "Failed to start capture";
    }
  });

  startCaptureButton.addEventListener('click', () => {
    if (isProcessing) {
      statusMessage.textContent = 'Please wait for current processing to complete';
      return;
    }
    
    // Reset FPS counter
    frameCount = 0;
    lastFpsUpdateTime = Date.now();
    fpsValue.textContent = '0';
    fpsCounter.classList.remove('hidden');
    
    // Update UI for continuous capture
    isContinuousCapture = true;
    updateCaptureUI(true);
    
    statusMessage.textContent = 'Starting continuous capture...';
    progressBar.style.width = '10%';
    
    // Request the background script to start continuous capture
    try {
      chrome.runtime.sendMessage({action: "startCapture"}, (response) => {
        if (response && !response.success) {
          resetUI();
          statusMessage.textContent = `Continuous capture failed: ${response.error || 'Unknown error'}`;
        }
      });
    } catch (err) {
      console.log("Error sending startCapture message:", err);
      resetUI();
      isContinuousCapture = false;
      updateCaptureUI(false);
      statusMessage.textContent = "Failed to start continuous capture";
    }
  });

  stopCaptureButton.addEventListener('click', () => {
    // Request the background script to stop continuous capture
    try {
      chrome.runtime.sendMessage({action: "stopCapture"});
      
      // Update UI immediately while waiting for background to confirm
      isContinuousCapture = false;
      updateCaptureUI(false);
      statusMessage.textContent = 'Stopping capture...';
      
      // Hide FPS counter after a short delay
      setTimeout(() => {
        fpsCounter.classList.add('hidden');
      }, 2000);
    } catch (err) {
      console.log("Error sending stopCapture message:", err);
      // Still update UI even if message failed
      isContinuousCapture = false;
      updateCaptureUI(false);
      statusMessage.textContent = 'Stopping capture (error occurred)';
    }
  });

  imageUpload.addEventListener('change', handleImageUpload);

  // Process an uploaded image
  async function handleImageUpload(e) {
    if (isProcessing) {
      statusMessage.textContent = 'Please wait for current processing to complete';
      return;
    }
    
    if (!e.target.files.length) return;
    
    const file = e.target.files[0];
    
    // Set processing flag and disable buttons
    isProcessing = true;
    disableButtons();
    
    // Display preview
    imagePreview.src = URL.createObjectURL(file);
    imagePreview.style.display = 'block';
    
    // Reset UI
    resultContainer.style.display = 'none';
    resultContainer.className = '';
    progressBar.style.width = '0%';
    statusMessage.textContent = 'Loading model...';
    
    try {
      // Load and run the model
      const result = await loadAndRunModel(file);
      
      // Store the result time
      lastResultTime = Date.now();
      
      // Send the result back to the background script
      if (result) {
        sendProcessingComplete(result);
      } else {
        // If no result, just signal completion
        sendProcessingComplete();
      }
    } catch (error) {
      console.error('Error processing image:', error);
      statusMessage.textContent = `Error: ${error.message}`;
      sendProcessingComplete();
    } finally {
      // Re-enable buttons and reset processing flag
      resetUI();
    }
  }

  // Process a captured screenshot
  async function handleCapturedImage(imageUrl, isContinuous) {
    // Update FPS counter if this is continuous capture
    if (isContinuous) {
      updateFpsCounter();
    }
    
    // Display preview
    imagePreview.src = imageUrl;
    imagePreview.style.display = 'block';
    
    // Reset UI for results
    resultContainer.style.display = 'none';
    resultContainer.className = '';
    progressBar.style.width = '20%';
    statusMessage.textContent = 'Processing screenshot...';
    
    try {
      // Convert data URL to blob
      const blob = await fetch(imageUrl).then(r => r.blob());
      
      // Create a File object from the blob
      const file = new File([blob], "screenshot.png", { type: "image/png" });
      
      // Load and run the model
      const result = await loadAndRunModel(file);
      
      // Store the result time
      lastResultTime = Date.now();
      
      // Send the result back to the background script
      if (result) {
        sendProcessingComplete(result);
      } else {
        // If no result, just signal completion
        sendProcessingComplete();
      }
    } catch (error) {
      console.error('Error processing screenshot:', error);
      statusMessage.textContent = `Error: ${error.message}`;
      
      // If an error occurred during continuous capture, stop it
      if (isContinuous) {
        try {
          chrome.runtime.sendMessage({action: "stopCapture"});
          isContinuousCapture = false;
          updateCaptureUI(false);
        } catch (err) {
          console.log("Error sending stopCapture message:", err);
        }
      }
      
      // Signal that processing is complete despite the error
      sendProcessingComplete();
    } finally {
      // If not in continuous capture, reset UI
      if (!isContinuous) {
        resetUI();
      }
    }
  }

  // Helper function to safely send processing completion message
  function sendProcessingComplete(result = null) {
    try {
      const message = {action: "processingComplete"};
      if (result) {
        message.result = {
          isBasketball: result.isBasketball,
          confidence: result.confidence
        };
      }
      chrome.runtime.sendMessage(message);
    } catch (err) {
      console.log("Could not send processing complete message:", err);
      // If we can't communicate with background, reset UI
      resetUI();
    }
  }

  async function loadAndRunModel(imageFile) {
    // Update progress
    progressBar.style.width = '30%';
    statusMessage.textContent = 'Loading ONNX runtime...';
    
    try {
      // Import onnxruntime-web
      if (!ort) {
        ort = await import('onnxruntime-web');
      }
      
      progressBar.style.width = '40%';
      statusMessage.textContent = 'Loading model...';

      // Create session options
      const sessionOptions = {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all'
      };

      // Create session and load model
      const modelPath = chrome.runtime.getURL('models/hypernetwork_basketball_classifier_quantized.onnx');
      const session = await ort.InferenceSession.create(modelPath, sessionOptions);

      progressBar.style.width = '60%';
      statusMessage.textContent = 'Processing image...';

      // Preprocess the image
      const processedImageTensor = await preprocessImage(imageFile);
      
      progressBar.style.width = '80%';
      statusMessage.textContent = 'Running inference...';

      // Run inference
      const inputName = session.inputNames[0];
      const feeds = {};
      feeds[inputName] = processedImageTensor;
      
      const results = await session.run(feeds);
      const outputName = session.outputNames[0];
      const prediction = results[outputName].data[0];

      // Update progress and display result
      progressBar.style.width = '100%';
      
      // Prepare result object
      const resultObject = {
        isBasketball: prediction > 0.5,
        confidence: prediction > 0.5 ? prediction : 1 - prediction
      };
      
      // Display the results
      displayResults(resultObject);
      
      // Return the result for passing back to background script
      return resultObject;
    } catch (error) {
      console.error('Error in model processing:', error);
      statusMessage.textContent = `Error: ${error.message}`;
      throw error;
    }
  }

  async function preprocessImage(imageFile) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      
      img.onload = () => {
        try {
          // Create a canvas to resize the image
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          
          // Set canvas size to target size (224x224)
          const targetSize = 224;
          canvas.width = targetSize;
          canvas.height = targetSize;
          
          // Draw and resize image on canvas
          ctx.drawImage(img, 0, 0, targetSize, targetSize);
          
          // Get image data
          const imageData = ctx.getImageData(0, 0, targetSize, targetSize);
          const data = imageData.data;
          
          // Create Float32Array for the model input
          // Use NHWC format (batch, height, width, channels) instead of NCHW
          const float32Data = new Float32Array(targetSize * targetSize * 3);
          
          // Rearrange the data to match the expected NHWC format
          let pixelIndex = 0;
          for (let h = 0; h < targetSize; h++) {
            for (let w = 0; w < targetSize; w++) {
              const offset = (h * targetSize + w) * 4; // RGBA format from canvas
              float32Data[pixelIndex++] = data[offset];     // R
              float32Data[pixelIndex++] = data[offset + 1]; // G 
              float32Data[pixelIndex++] = data[offset + 2]; // B
            }
          }
          
          // Create tensor with NHWC format [1, 224, 224, 3] (batch, height, width, channels)
          const tensor = new ort.Tensor('float32', float32Data, [1, targetSize, targetSize, 3]);
          
          resolve(tensor);
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };
      
      if (imageFile instanceof File || imageFile instanceof Blob) {
        img.src = URL.createObjectURL(imageFile);
      } else if (typeof imageFile === 'string' && imageFile.startsWith('data:')) {
        img.src = imageFile; // Handle data URLs directly
      } else {
        reject(new Error('Invalid image format'));
      }
    });
  }

  // Display results from model inference
  function displayResults(result) {
    const isBasketball = result.isBasketball;
    const confidence = result.confidence;
    const percentConfidence = (confidence * 100).toFixed(2);
    
    resultContainer.style.display = 'block';
    
    if (isBasketball) {
      resultContainer.className = 'basketball';
      resultText.textContent = 'Basketball detected!';
    } else {
      resultContainer.className = 'not-basketball';
      resultText.textContent = 'Not a basketball image';
    }
    
    confidenceText.textContent = `Confidence: ${percentConfidence}%`;
    
    // Only update status message if not in continuous mode
    if (!isContinuousCapture) {
      statusMessage.textContent = 'Analysis complete';
    }
  }
  
  // Display result received from background processing
  function displayBackgroundResult(result) {
    console.log("Displaying background result:", result);
    
    // Show the result container
    resultContainer.style.display = 'block';
    
    // Determine classification and format confidence
    const isBasketball = result.isBasketball;
    const percentConfidence = (result.confidence * 100).toFixed(2);
    
    // Update UI
    if (isBasketball) {
      resultContainer.className = 'basketball';
      resultText.textContent = 'Basketball detected!';
    } else {
      resultContainer.className = 'not-basketball';
      resultText.textContent = 'Not a basketball image';
    }
    
    confidenceText.textContent = `Confidence: ${percentConfidence}%`;
    
    // Add a note that this was processed in background
    statusMessage.textContent = 'Last result from background processing';
  }
  
  // Helper functions
  function updateCaptureUI(isCapturing) {
    if (isCapturing) {
      startCaptureButton.classList.add('hidden');
      stopCaptureButton.classList.remove('hidden');
      singleCaptureButton.disabled = true;
      uploadButton.disabled = true;
    } else {
      startCaptureButton.classList.remove('hidden');
      stopCaptureButton.classList.add('hidden');
      singleCaptureButton.disabled = false;
      uploadButton.disabled = false;
    }
  }
  
  function disableButtons() {
    singleCaptureButton.disabled = true;
    uploadButton.disabled = true;
    startCaptureButton.disabled = true;
    isProcessing = true;
  }
  
  function resetUI() {
    singleCaptureButton.disabled = false;
    uploadButton.disabled = false;
    startCaptureButton.disabled = false;
    isProcessing = false;
  }
  
  function updateFpsCounter() {
    frameCount++;
    const now = Date.now();
    const elapsed = now - lastFpsUpdateTime;
    
    if (elapsed >= fpsUpdateInterval) {
      const fps = Math.round((frameCount * 1000) / elapsed);
      fpsValue.textContent = fps.toString();
      frameCount = 0;
      lastFpsUpdateTime = now;
    }
  }
}); 