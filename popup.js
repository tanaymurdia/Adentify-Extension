document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('startBtn');
  const sensitivitySlider = document.getElementById('sensitivity');
  const sensitivityValue = document.getElementById('sensitivityValue');
  const volumeControl = document.getElementById('volumeControl');
  const modelStatus = document.getElementById('modelStatus');
  
  // Initialize settings from storage
  chrome.storage.sync.get({
    sensitivity: 30,
    overlayActive: false
  }, (items) => {
    sensitivitySlider.value = items.sensitivity;
    sensitivityValue.textContent = items.sensitivity;
    
    // Hide volume control as it's disabled
    if (volumeControl) {
      volumeControl.parentElement.style.display = 'none';
    }
    
    // Update button text if overlay is already active
    if (items.overlayActive) {
      startBtn.textContent = 'Stop Overlay';
      startBtn.classList.add('active');
    }
  });
  
  // Check model status
  chrome.runtime.sendMessage({ action: 'checkModelStatus' }, (response) => {
    if (response && response.status) {
      modelStatus.textContent = response.status;
    }
  });
  
  // Listen for model status updates
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'modelStatusUpdate' && modelStatus) {
      modelStatus.textContent = request.status;
    }
    return true;
  });
  
  // Handle sensitivity slider
  sensitivitySlider.addEventListener('input', () => {
    const value = sensitivitySlider.value;
    sensitivityValue.textContent = value;
    
    chrome.storage.sync.set({ sensitivity: parseInt(value) });
    chrome.runtime.sendMessage({ 
      action: 'updateSettings', 
      settings: { sensitivity: parseInt(value) } 
    });
  });
  
  // Function to check if content script is loaded and inject if needed
  async function ensureContentScriptLoaded(tabId) {
    try {
      // First, try to ping the content script
      const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' }).catch(e => null);
      
      // If we got a response, content script is loaded
      if (response && response.pong) {
        return true;
      }
      
      // If we get here, we need to inject the content script
      console.log('Content script not found, injecting...');
      
      // Inject CSS first
      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['content.css']
      });
      
      // Then inject JavaScript
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      
      // Wait a bit for the script to initialize
      return new Promise(resolve => setTimeout(() => resolve(true), 500));
    } catch (error) {
      console.error('Error ensuring content script is loaded:', error);
      return false;
    }
  }
  
  // Handle start/stop button
  startBtn.addEventListener('click', async () => {
    const isActive = startBtn.classList.contains('active');
    
    try {
      // Get the current active tab
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || !tabs[0]) {
        alert('Cannot access the current tab.');
        return;
      }
      
      const tab = tabs[0];
      
      // Check if we can access the tab
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('edge://') || tab.url.startsWith('about:')) {
        alert('The extension cannot run on this page due to browser restrictions.');
        return;
      }
      
      if (isActive) {
        // Stop overlay - attempt to ensure content script is loaded first
        await ensureContentScriptLoaded(tab.id);
        
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'stopOverlay' });
        } catch (error) {
          console.log('Could not connect to content script:', error);
        }
        
        // Update UI regardless of success
        startBtn.textContent = 'Start Overlay';
        startBtn.classList.remove('active');
        chrome.storage.sync.set({ overlayActive: false });
      } else {
        // Start overlay - ensure content script is loaded first
        const contentScriptLoaded = await ensureContentScriptLoaded(tab.id);
        
        if (!contentScriptLoaded) {
          alert('Could not load the extension on this page. Please refresh and try again.');
          return;
        }
        
        try {
          await chrome.tabs.sendMessage(tab.id, { action: 'startOverlay' });
          startBtn.textContent = 'Stop Overlay';
          startBtn.classList.add('active');
          chrome.storage.sync.set({ overlayActive: true });
        } catch (error) {
          console.error('Error starting overlay:', error);
          alert('Could not connect to the page. Please refresh the page and try again.');
        }
      }
    } catch (error) {
      console.error('Error in start/stop button handler:', error);
      alert('An error occurred. Please refresh the page and try again.');
    }
  });
}); 