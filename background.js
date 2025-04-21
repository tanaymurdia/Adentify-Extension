// Background script for Basketball Classifier Extension

// Track the tab and capture state
let targetTabId = null;
let isCapturing = false;
let continuousCapture = false;
let popupOpen = false;
let lastResult = null;
let captureDelay = 200; // Increased delay between captures (200ms)

// Log when the extension is installed
chrome.runtime.onInstalled.addListener(() => {
  console.log("Basketball Image Classifier extension installed");
  
  // Make sure ONNX model files are accessible
  try {
    chrome.runtime.getPackageDirectoryEntry(function(root) {
      root.getDirectory("models", {create: false}, function(modelsDir) {
        modelsDir.getFile("hypernetwork_basketball_classifier_quantized.onnx", {create: false}, function(fileEntry) {
          console.log("ONNX model file found");
        }, function(error) {
          console.error("ONNX model file not found:", error);
        });
      }, function(error) {
        console.error("Models directory not found:", error);
      });
    });
  } catch (e) {
    console.log("Could not check model files: ", e);
  }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message.action);
  
  if (message.action === "popupOpened") {
    // Popup has opened - respond immediately with current state
    popupOpen = true;
    sendResponse({
      isCapturing: isCapturing,
      isContinuous: continuousCapture,
      lastResult: lastResult
    });
    return false; // No async response
  }
  else if (message.action === "popupClosed") {
    // Popup is about to close, but we'll continue capturing
    popupOpen = false;
    sendResponse({success: true});
    return false;
  }
  else if (message.action === "startCapture") {
    // Start continuous capture
    if (isCapturing) {
      sendResponse({ success: false, error: "Capture already in progress" });
      return false;
    }

    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs.length > 0) {
        targetTabId = tabs[0].id;
        startContinuousCapture(targetTabId);
        // Send immediate response to avoid message channel closing
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: "No active tab found" });
      }
    });
    return false; // No async response now that we've handled it synchronously
  } 
  else if (message.action === "stopCapture") {
    // Stop continuous capture
    stopContinuousCapture();
    sendResponse({ success: true });
    return false;
  }
  else if (message.action === "singleCapture") {
    // Capture a single frame
    if (isCapturing) {
      sendResponse({ success: false, error: "Capture already in progress" });
      return false;
    }

    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs.length > 0) {
        targetTabId = tabs[0].id;
        captureTab(targetTabId, false);
        // Send immediate response
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: "No active tab found" });
      }
    });
    return false; // No async response
  }
  else if (message.action === "checkCapturing") {
    // Check if we're currently capturing
    sendResponse({ 
      isCapturing: isCapturing,
      isContinuous: continuousCapture,
      lastResult: lastResult
    });
    return false;
  } 
  else if (message.action === "processingComplete") {
    // Store result from popup if provided
    if (message.result) {
      lastResult = message.result;
    }
    
    // Reset capturing flag when processing is complete
    isCapturing = false;
    console.log("Processing completed, ready for next capture");
    
    // If continuous capture is active, capture the next frame
    if (continuousCapture && targetTabId) {
      // Longer delay to prevent overwhelming the system
      setTimeout(() => {
        if (continuousCapture) {  // Check again in case it was stopped during the timeout
          captureTab(targetTabId, true);
        }
      }, captureDelay); 
    }
    return false;
  }
});

// Setup a cleanup timer to periodically check if we need to stop capturing
setInterval(() => {
  // If we're capturing, check if the tab still exists
  if (continuousCapture && targetTabId) {
    chrome.tabs.get(targetTabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        console.log("Target tab no longer exists, stopping capture");
        stopContinuousCapture();
      }
    });
  }
}, 5000);

// Function to start continuous capture
function startContinuousCapture(tabId) {
  console.log("Starting continuous capture for tab:", tabId);
  continuousCapture = true;
  lastResult = null;
  
  // Start with first capture
  captureTab(tabId, true);
}

// Function to stop continuous capture
function stopContinuousCapture() {
  console.log("Stopping continuous capture");
  continuousCapture = false;
  
  // Notify popup that continuous capture has stopped (if open)
  if (popupOpen) {
    chrome.runtime.sendMessage({
      action: "captureStatusChanged",
      isContinuous: false
    }).catch(err => {
      // Handle error if popup is closed
      console.log("Could not send message to popup:", err);
    });
  }
}

// Function to capture a specific tab
function captureTab(tabId, isContinuous) {
  try {
    console.log("Capturing tab:", tabId);
    isCapturing = true;
    
    // Check if tab still exists
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || !tab) {
        console.log("Tab no longer exists:", chrome.runtime.lastError);
        isCapturing = false;
        if (isContinuous) continuousCapture = false;
        return;
      }
      
      // Use chrome.tabs.captureVisibleTab which is available in Manifest V3
      chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
        if (chrome.runtime.lastError) {
          console.error("Error capturing tab:", chrome.runtime.lastError);
          handleCaptureError(chrome.runtime.lastError.message, isContinuous);
          return;
        }
        
        if (!dataUrl) {
          console.error("Failed to capture tab. Data URL is null.");
          handleCaptureError("Failed to capture tab", isContinuous);
          return;
        }
        
        // Process the captured image if popup is open, otherwise do it in the background
        if (popupOpen) {
          // Send the image to the popup for processing
          chrome.runtime.sendMessage({
            action: "screenshotCaptured",
            imageUrl: dataUrl,
            isContinuous: isContinuous
          }).catch(err => {
            console.log("Could not send screenshot to popup:", err);
            
            // If we can't send to popup but are in continuous mode,
            // we should process the image ourselves to continue the loop
            if (isContinuous) {
              processImageInBackground(dataUrl);
            } else {
              // For single capture, just stop if popup is not available
              isCapturing = false;
            }
          });
        } else if (isContinuous) {
          // If popup is closed but we're in continuous mode, process in background
          processImageInBackground(dataUrl);
        } else {
          // Single capture with no popup to display it - just stop
          isCapturing = false;
        }
      });
    });
  } catch (error) {
    console.error("Error in captureTab:", error);
    handleCaptureError(error.message, isContinuous);
  }
}

// Handle capture errors
function handleCaptureError(errorMessage, isContinuous) {
  isCapturing = false;
  
  if (isContinuous) {
    // If in continuous mode, pause briefly and try again instead of stopping completely
    console.log("Error in continuous capture, pausing briefly:", errorMessage);
    setTimeout(() => {
      if (continuousCapture && targetTabId) {
        captureTab(targetTabId, true);
      }
    }, 1000); // Wait a bit longer after an error
  } else {
    // For single capture, just stop completely
    continuousCapture = false;
    
    // Notify popup if it's open
    if (popupOpen) {
      chrome.runtime.sendMessage({
        action: "captureError",
        error: errorMessage
      }).catch(err => console.log("Could not send error to popup:", err));
    }
  }
}

// Process image in background when popup is closed
function processImageInBackground(dataUrl) {
  // For background processing, we'll use a simple approach
  // In a real extension, you might use a worker or offscreen document for this
  
  // Create an Image object to load the data URL
  const img = new Image();
  img.onload = function() {
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
      
      // We're just simulating the processing here without actually running the model
      // In a real implementation, you'd load the ONNX model and run inference
      console.log("Background processed image (simulated)");
      
      // Store a fake result for demonstration
      lastResult = {
        isBasketball: Math.random() > 0.5,
        confidence: 0.5 + Math.random() * 0.5
      };
      
      // Signal that processing is complete so the next capture can happen
      isCapturing = false;
      
      // If continuous capture is active, schedule the next capture
      if (continuousCapture && targetTabId) {
        setTimeout(() => {
          if (continuousCapture) {
            captureTab(targetTabId, true);
          }
        }, captureDelay);
      }
    } catch (error) {
      console.error("Error in background processing:", error);
      handleCaptureError(error.message, true);
    }
  };
  
  img.onerror = function() {
    console.error("Failed to load image in background");
    handleCaptureError("Failed to load image", true);
  };
  
  img.src = dataUrl;
} 