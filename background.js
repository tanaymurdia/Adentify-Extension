// Background script for Basketball Classifier extension
// This script only handles messaging and settings storage
// The actual model loading and inference happens in the content script

// State
let modelStatus = 'Not loaded - using content script instead';

// Initialize settings
const settings = {
  sensitivity: 30
};

// Listen for messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'checkModelStatus') {
    sendResponse({ status: modelStatus });
    return true;
  } else if (request.action === 'updateSettings') {
    if (request.settings.sensitivity !== undefined) {
      settings.sensitivity = request.settings.sensitivity;
    }
    
    // Forward settings to any active content scripts
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'updateSettings',
          settings: settings
        }).catch(err => {
          console.log('No content script active to receive settings');
        });
      }
    });
    
    return true;
  } else if (request.action === 'getSettings') {
    sendResponse({ settings });
    return true;
  } else if (request.action === 'modelStatusUpdate') {
    // Update our status when the content script reports model status
    modelStatus = request.status;
    
    // Forward to popup if open
    chrome.runtime.sendMessage({
      action: 'modelStatusUpdate',
      status: modelStatus
    }).catch(err => {
      console.log('No receivers for model status update');
    });
    
    return true;
  } else if (request.action === 'captureTab') {
    // Capture the current tab for the content script
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.captureVisibleTab(null, {format: 'jpeg', quality: 70}, (dataUrl) => {
          if (chrome.runtime.lastError) {
            console.error('Error capturing tab:', chrome.runtime.lastError);
            sendResponse({ error: chrome.runtime.lastError.message });
          } else {
            console.log('Tab captured successfully');
            sendResponse({ imageDataUrl: dataUrl });
          }
        });
      } else {
        sendResponse({ error: 'No active tab found' });
      }
    });
    return true;
  }
}); 