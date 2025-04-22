// --- Injection Guard ---
if (window.adentifyScriptInjected) {
  console.log("Adentify content script already injected. Exiting.");
  // Potentially throw an error or just return to stop execution
  // For now, just log and let it implicitly stop
} else {
  window.adentifyScriptInjected = true;
  console.log("Content script running for the first time.");

  console.log("Content script loaded.");

  // --- UI Elements ---
  const uiContainer = document.createElement('div');
  const previewContainer = document.createElement('div');
  const previewCanvas = document.createElement('canvas');
  const previewCtx = previewCanvas.getContext('2d');
  const startCaptureButton = document.createElement('button');
  const stopCaptureButton = document.createElement('button');
  const closeButton = document.createElement('button');
  const statusMessage = document.createElement('span');
  const restrictedMessageDiv = document.createElement('div');
  const predictionDisplay = document.createElement('div');
  const dragHandle = document.createElement('span');
  const recordingControls = document.createElement('div');
  const previewToggleButton = document.createElement('button');

  // --- State ---
  let isCaptureActive = false;
  let isPageRestricted = false;
  let lastFrameTime = 0;
  const FRAME_RATE_LIMIT = 15;
  let isPreviewVisible = true;

  // --- Draggable State ---
  let isDragging = false;
  let currentX;
  let currentY;
  let initialX;
  let initialY;
  let xOffset = 0;
  let yOffset = 0;

  // Define the blue accent color consistently
  const BLUE_ACCENT_COLOR = '#00bfff'; // Or match the exact CSS glow color if needed

  // --- Setup UI Container ---
  uiContainer.id = 'adentify-ui';
  document.body.appendChild(uiContainer);

  // --- Setup Corner Elements (Append directly to uiContainer) ---
  closeButton.id = 'adentify-close-btn';
  closeButton.textContent = '✕';
  closeButton.removeAttribute('style');
  closeButton.addEventListener('click', () => {
      console.log("Close button clicked");
      toggleOverlay(false);
  });
  uiContainer.appendChild(closeButton);

  dragHandle.id = 'adentify-drag-handle';
  dragHandle.textContent = '⠿';
  dragHandle.removeAttribute('style');
  dragHandle.addEventListener('mousedown', dragStart);
  uiContainer.appendChild(dragHandle);

  // --- Setup Initial Content (Start Button) ---
  startCaptureButton.textContent = 'Start';
  startCaptureButton.id = 'start-capture-btn';
  startCaptureButton.removeAttribute('style');
  startCaptureButton.addEventListener('click', () => {
      console.log(`Start Capture clicked, type: tab (hardcoded)`);
      chrome.runtime.sendMessage({ type: 'request-start-tab-capture' });
      startCaptureButton.disabled = true;
      statusMessage.textContent = 'Starting...';
  });
  uiContainer.appendChild(startCaptureButton);

  // --- Setup Recording Content (Preview + Controls + Toggle) ---
  previewContainer.id = 'adentify-preview';

  // NEW Canvas Wrapper
  const canvasWrapper = document.createElement('div');
  canvasWrapper.id = 'adentify-canvas-wrapper';

  previewCanvas.id = 'adentify-preview-canvas';
  previewCanvas.width = 240; // Keep size, adjust in CSS if needed
  previewCanvas.height = 135;
  // previewContainer.appendChild(previewCanvas); // Append canvas to wrapper instead
  canvasWrapper.appendChild(previewCanvas); // Canvas goes inside the wrapper
  previewContainer.appendChild(canvasWrapper); // Wrapper goes inside the preview container

  uiContainer.appendChild(previewContainer);

  recordingControls.id = 'adentify-recording-controls';
  // Styles moved to CSS

  // Append elements in NEW order: Prediction -> Toggle -> Status -> Stop
  predictionDisplay.id = 'adentify-prediction';
  predictionDisplay.textContent = 'No Basketball'; // Initial reset state
  recordingControls.appendChild(predictionDisplay);

  // Create and Add Preview Toggle Button HERE
  previewToggleButton.id = 'adentify-preview-toggle-btn';
  previewToggleButton.textContent = 'Hide Preview'; // Initial state
  previewToggleButton.removeAttribute('style'); // Rely on CSS
  previewToggleButton.addEventListener('click', () => {
      // Toggle the class on the main container instead
      uiContainer.classList.toggle('preview-hidden');
      previewToggleButton.textContent = uiContainer.classList.contains('preview-hidden') ? 'Show Preview' : 'Hide Preview';
  });
  recordingControls.appendChild(previewToggleButton); // Add to controls div

  statusMessage.id = 'adentify-status'; // Keep status message for errors
  statusMessage.removeAttribute('style');
  recordingControls.appendChild(statusMessage); // Place it after toggle

  stopCaptureButton.textContent = 'Stop';
  stopCaptureButton.id = 'stop-capture-btn';
  // Styles moved to CSS
  stopCaptureButton.removeAttribute('style');
  stopCaptureButton.addEventListener('click', () => {
      console.log("Stop Capture button clicked");
      chrome.runtime.sendMessage({ type: 'request-stop-capture' });
      stopCaptureButton.disabled = true;
      statusMessage.textContent = 'Stopping...';
  });
  recordingControls.appendChild(stopCaptureButton);

  uiContainer.appendChild(recordingControls);

  // --- Setup Restricted Message ---
  restrictedMessageDiv.id = 'adentify-restricted-msg';
  restrictedMessageDiv.textContent = 'Screen recording is not available on this page.';
  uiContainer.appendChild(restrictedMessageDiv);

  // --- Update UI based on capture state ---
  function updateUIForCaptureState(isActive, error = null) {
      isCaptureActive = isActive;
      console.log(`Updating UI - Capture Active: ${isCaptureActive}, Error: ${error}`);

      // Toggle class on main container for CSS-driven animations/styles
      uiContainer.classList.toggle('recording-active', isActive);

      // Handle preview state based on capture state
      if (isActive) {
        uiContainer.classList.add('preview-hidden'); // Default to hidden when starting
        previewToggleButton.textContent = 'Show Preview';
      } else {
        uiContainer.classList.remove('preview-hidden'); // Ensure reset when stopped
        previewToggleButton.textContent = 'Hide Preview';
      }

      // Only toggle .hidden for the Start button
      startCaptureButton.classList.toggle('hidden', isActive);
      startCaptureButton.disabled = false; // Re-enable unless starting

      // Show/hide recording specific elements - REMOVED .hidden toggles here
      // recordingControls.classList.toggle('hidden', !isActive);
      // previewToggleButton.classList.toggle('hidden', !isActive);
      stopCaptureButton.disabled = false; // Re-enable unless stopping

      // Update status message visibility and content
      if (isActive) {
          statusMessage.classList.add('hidden');
      } else if (error) {
          statusMessage.textContent = `Error: ${error}`;
          statusMessage.style.color = '#FFB74D';
          statusMessage.classList.remove('hidden');
      } else {
          statusMessage.textContent = '';
          statusMessage.classList.add('hidden');
          statusMessage.style.color = '';
      }
  }

  // --- Toggle Overlay Visibility ---
  function toggleOverlay(forceShow) {
      const shouldShow = forceShow !== undefined ? forceShow : uiContainer.classList.contains('hidden');
      console.log(`toggleOverlay called. Current hidden: ${uiContainer.classList.contains('hidden')}, shouldShow: ${shouldShow}`);

      // We still use .hidden for the *overall* UI container visibility
      if (shouldShow) {
          uiContainer.classList.remove('hidden');
          if (isPageRestricted) {
              // ... (hiding elements including preview, toggle, controls)
              startCaptureButton.classList.add('hidden');
              // Ensure animated elements are hidden immediately on restricted pages
              previewContainer.classList.add('hidden');
              previewToggleButton.classList.add('hidden');
              recordingControls.classList.add('hidden');
              closeButton.classList.add('hidden');
              dragHandle.classList.add('hidden');
              restrictedMessageDiv.classList.remove('hidden');
          } else {
              restrictedMessageDiv.classList.add('hidden');
              closeButton.classList.remove('hidden');
              dragHandle.classList.remove('hidden');
              // updateUI will handle toggling .recording-active and start button .hidden
              updateUIForCaptureState(isCaptureActive);
          }
      } else {
          uiContainer.classList.add('hidden');
      }
  }

  // --- Handle Preview Frame ---
  function drawPreviewFrame(dataUrl) {
      const now = performance.now();
      if (now - lastFrameTime < (1000 / FRAME_RATE_LIMIT)) {
          return;
      }
      lastFrameTime = now;

      const img = new Image();
      img.onload = () => {
          const hRatio = previewCanvas.width / img.width;
          const vRatio = previewCanvas.height / img.height;
          const ratio = Math.min(hRatio, vRatio);
          const centerShift_x = (previewCanvas.width - img.width * ratio) / 2;
          const centerShift_y = (previewCanvas.height - img.height * ratio) / 2;

          previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
          previewCtx.drawImage(img, 0, 0, img.width, img.height,
                               centerShift_x, centerShift_y, img.width * ratio, img.height * ratio);
      };
      img.onerror = () => {
          console.error("Error loading preview frame image");
          previewCtx.fillStyle = 'red';
          previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
      };
      img.src = dataUrl;
  }

  // --- Message Listener from Background ---
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Content script: Received message type:", message.type);

    let needsResponse = false;
    switch (message.type) {
      case 'toggle-overlay':
          console.log("Message received: toggle-overlay");
          toggleOverlay();
          break;
      case 'capture-state-active':
          console.log("Message received: capture-state-active");
          // Force setting the initial text BEFORE updating the rest of the UI state
          previewToggleButton.textContent = 'Show Preview';
          updateUIForCaptureState(true);
          toggleOverlay(true);
          break;
      case 'capture-state-inactive':
          console.log("Message received: capture-state-inactive");
          const errorMsg = message.payload?.error;
          updateUIForCaptureState(false, errorMsg);
          toggleOverlay(true);
          break;
      case 'preview-frame':
          if (isCaptureActive && message.payload?.frameDataUrl) {
              drawPreviewFrame(message.payload.frameDataUrl);
          }
          break;
      case 'onnxPrediction':
          const predictionText = message.payload?.prediction;
          if (isCaptureActive && predictionText) {
              // Simplify text and apply conditional styling class
              // Check specifically for the positive detection string from the worker
              if (predictionText === "Basketball Detected") { // More specific check
                  predictionDisplay.textContent = 'Basketball';
                  predictionDisplay.classList.add('prediction-basketball');
              } else {
                  // Assume anything else is "No Basketball"
                  predictionDisplay.textContent = 'No Basketball';
                  predictionDisplay.classList.remove('prediction-basketball');
              }
          } else if (!isCaptureActive) {
               // Reset if somehow received while inactive (shouldn't happen often)
               predictionDisplay.textContent = 'No Basketball';
               predictionDisplay.classList.remove('prediction-basketball');
          }
          break;
    }
    return needsResponse;
  });

  console.log("Content script attaching event listeners and setting initial state.");

  // Initial Page Check
  const currentUrl = window.location.href;
  const currentHostname = window.location.hostname;
  if (currentUrl.startsWith('chrome:') || currentHostname === 'chrome.google.com') {
      console.warn("Content script running on a restricted page.");
      isPageRestricted = true;
  } else {
      console.log("Content script running on a standard page.");
      isPageRestricted = false;
  }

  // Set initial state, position & hidden class
  uiContainer.classList.add('hidden');
  const initialPadding = 20;
  // Set initial position to top-left with padding
  xOffset = initialPadding;
  yOffset = initialPadding;
  setTranslate(xOffset, yOffset, uiContainer); // Use xOffset, yOffset directly

  // Set initial element visibility based on page restriction
  if (isPageRestricted) {
      // ... (hiding corner buttons)
      startCaptureButton.classList.add('hidden');
      // Also hide the other elements that are normally hidden initially
      previewContainer.classList.add('hidden');
      previewToggleButton.classList.add('hidden');
      recordingControls.classList.add('hidden');
      restrictedMessageDiv.classList.add('hidden'); // Start hidden, toggleOverlay will show it
  } else {
      restrictedMessageDiv.classList.add('hidden');
      // previewToggleButton.classList.add('hidden'); // REMOVED - CSS handles initial hide
      // Ensure elements start hidden via CSS opacity/visibility
      updateUIForCaptureState(false); // Start with Start button visible
  }

  console.log("Content script initial setup complete.");

  // --- Event Listeners for Dragging ---
  function dragStart(e) {
      if (e.button !== 0) return;

      if (e.target === dragHandle) {
          initialX = e.clientX - xOffset;
          initialY = e.clientY - yOffset;
          isDragging = true;
          document.addEventListener('mousemove', drag);
          document.addEventListener('mouseup', dragEnd);
          e.preventDefault();
      }
  }

  function drag(e) {
      if (!isDragging) return;
      e.preventDefault();

      currentX = e.clientX - initialX;
      currentY = e.clientY - initialY;

      xOffset = currentX;
      yOffset = currentY;

      setTranslate(currentX, currentY, uiContainer);
  }

  function setTranslate(xPos, yPos, el) {
      el.style.transform = `translate3d(${xPos}px, ${yPos}px, 0)`;
  }

  function dragEnd(e) {
      if (!isDragging) return;
      isDragging = false;
      document.removeEventListener('mousemove', drag);
      document.removeEventListener('mouseup', dragEnd);
  }
} // End of injection guard else block 