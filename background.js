// Background script for Basketball Classifier Extension

// Track the tab we want to capture
let targetTabId = null;
let isCapturing = false;

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
  if (message.action === "captureTab") {
    // If popup is requesting tab capture, store the current tab ID and initiate capture
    if (isCapturing) {
      // Already capturing, don't start new capture
      sendResponse({ success: false, error: "Capture already in progress" });
      return true;
    }

    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs.length > 0) {
        targetTabId = tabs[0].id;
        captureTab(targetTabId);
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: "No active tab found" });
      }
    });
    return true; // Indicates async response
  } else if (message.action === "checkCapturing") {
    // Popup is checking if we're currently capturing
    sendResponse({ isCapturing: isCapturing });
    return false;
  } else if (message.action === "processingComplete") {
    // Reset capturing flag when processing is complete
    isCapturing = false;
    console.log("Processing completed, ready for next capture");
    return false;
  }
});

// Function to capture a specific tab
function captureTab(tabId) {
  try {
    console.log("Attempting to capture tab:", tabId);
    isCapturing = true;
    
    // Use chrome.tabs.captureVisibleTab which is available in Manifest V3
    chrome.tabs.captureVisibleTab(null, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        console.error("Error capturing tab:", chrome.runtime.lastError);
        isCapturing = false;
        chrome.runtime.sendMessage({
          action: "captureError",
          error: chrome.runtime.lastError.message
        });
        return;
      }
      
      if (!dataUrl) {
        console.error("Failed to capture tab. Data URL is null.");
        isCapturing = false;
        chrome.runtime.sendMessage({
          action: "captureError",
          error: "Failed to capture tab"
        });
        return;
      }
      
      // Send the captured image to the popup
      console.log("Screenshot captured for tab ID:", tabId);
      chrome.runtime.sendMessage({
        action: "screenshotCaptured",
        imageUrl: dataUrl
      });
      
      // Note: We don't reset isCapturing here - it will be reset when processing is complete
    });
  } catch (error) {
    console.error("Error in captureTab:", error);
    isCapturing = false;
    chrome.runtime.sendMessage({
      action: "captureError",
      error: error.message
    });
  }
} 