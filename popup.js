// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
  // Elements
  const uploadButton = document.getElementById('uploadButton');
  const imageUpload = document.getElementById('imageUpload');
  const imagePreview = document.getElementById('imagePreview');
  const resultContainer = document.getElementById('resultContainer');
  const resultText = document.getElementById('resultText');
  const confidenceText = document.getElementById('confidenceText');
  const statusMessage = document.getElementById('statusMessage');
  const progressBar = document.getElementById('progressBar');

  // Global reference to ort
  let ort;

  // Event listeners
  uploadButton.addEventListener('click', () => {
    imageUpload.click();
  });

  imageUpload.addEventListener('change', handleImageUpload);

  async function handleImageUpload(e) {
    if (!e.target.files.length) return;
    
    const file = e.target.files[0];
    
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
    }
  }

  async function loadAndRunModel(imageFile) {
    // Update progress
    progressBar.style.width = '20%';
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
      
      img.src = URL.createObjectURL(imageFile);
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