// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const uploadButton = document.getElementById('uploadButton');
  const captureButton = document.getElementById('captureButton');
  const imageUpload = document.getElementById('imageUpload');
  const imagePreview = document.getElementById('imagePreview');
  const resultContainer = document.getElementById('resultContainer');
  const resultText = document.getElementById('resultText');
  const confidenceText = document.getElementById('confidenceText');
  const statusMessage = document.getElementById('statusMessage');
  const progressBar = document.getElementById('progressBar');

  // State flags
  let isProcessing = false;
  let ort = null;

  // Check if there's a capture in progress when popup opens
  chrome.runtime.sendMessage({action: "checkCapturing"}, function(response) {
    if (response && response.isCapturing) {
      captureButton.disabled = true;
      uploadButton.disabled = true;
      statusMessage.textContent = 'Capture in progress...';
      progressBar.style.width = '10%';
      isProcessing = true;
    }
  });

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "screenshotCaptured") {
      // Process the captured screenshot
      handleCapturedImage(message.imageUrl);
      return true;
    } else if (message.action === "captureError") {
      // Handle capture error
      captureButton.disabled = false;
      uploadButton.disabled = false;
      statusMessage.textContent = `Capture error: ${message.error}`;
      progressBar.style.width = '0%';
      isProcessing = false;
      return true;
    }
  });

  // Event listeners
  uploadButton.addEventListener('click', () => {
    if (isProcessing) {
      statusMessage.textContent = 'Please wait for current processing to complete';
      return;
    }
    imageUpload.click();
  });

  captureButton.addEventListener('click', () => {
    if (isProcessing) {
      statusMessage.textContent = 'Please wait for current processing to complete';
      return;
    }
    
    // Disable buttons and update UI
    captureButton.disabled = true;
    uploadButton.disabled = true;
    isProcessing = true;
    
    statusMessage.textContent = 'Capturing tab...';
    progressBar.style.width = '10%';
    
    // Reset result display
    resultContainer.style.display = 'none';
    resultContainer.className = '';
    
    // Request the background script to capture the tab
    chrome.runtime.sendMessage({action: "captureTab"}, (response) => {
      if (response && !response.success) {
        statusMessage.textContent = `Capture failed: ${response.error || 'Unknown error'}`;
        captureButton.disabled = false;
        uploadButton.disabled = false;
        progressBar.style.width = '0%';
        isProcessing = false;
      }
    });
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
    captureButton.disabled = true;
    uploadButton.disabled = true;
    
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
      await loadAndRunModel(file);
    } catch (error) {
      console.error('Error processing image:', error);
      statusMessage.textContent = `Error: ${error.message}`;
    } finally {
      // Re-enable buttons and reset processing flag
      captureButton.disabled = false;
      uploadButton.disabled = false;
      isProcessing = false;
    }
  }

  // Process a captured screenshot
  async function handleCapturedImage(imageUrl) {
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
      await loadAndRunModel(file);
    } catch (error) {
      console.error('Error processing screenshot:', error);
      statusMessage.textContent = `Error: ${error.message}`;
    } finally {
      // Re-enable buttons, reset processing flag, and notify background script
      captureButton.disabled = false;
      uploadButton.disabled = false;
      isProcessing = false;
      
      // Notify background script that processing is complete
      chrome.runtime.sendMessage({action: "processingComplete"});
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
      displayResults(prediction);
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

  function displayResults(prediction) {
    // Display the results
    const isBasketball = prediction > 0.5;
    const confidence = isBasketball ? prediction : 1 - prediction;
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
    statusMessage.textContent = 'Analysis complete';
  }
}); 