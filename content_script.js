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

  // --- State ---
  let isCaptureActive = false;
  let isPageRestricted = false;
  let lastFrameTime = 0;
  const FRAME_RATE_LIMIT = 15;

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

  // --- Setup Recording Content (Preview + Controls) ---
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

  stopCaptureButton.textContent = 'Stop';
  stopCaptureButton.id = 'stop-capture-btn';
  stopCaptureButton.removeAttribute('style');
  stopCaptureButton.addEventListener('click', () => {
      console.log("Stop Capture button clicked");
      chrome.runtime.sendMessage({ type: 'request-stop-capture' });
      stopCaptureButton.disabled = true;
      statusMessage.textContent = 'Stopping...';
  });
  recordingControls.appendChild(stopCaptureButton);

  predictionDisplay.id = 'adentify-prediction';
  predictionDisplay.textContent = 'Prediction: N/A';
  recordingControls.appendChild(predictionDisplay);

  uiContainer.appendChild(recordingControls);

  // --- Setup Restricted Message ---
  restrictedMessageDiv.id = 'adentify-restricted-msg';
  restrictedMessageDiv.textContent = 'Screen recording is not available on this page.';
  uiContainer.appendChild(restrictedMessageDiv);

  // --- Setup Status Message ---
  statusMessage.id = 'adentify-status';
  statusMessage.removeAttribute('style');
  recordingControls.appendChild(statusMessage);

  // --- Update UI based on capture state ---
  function updateUIForCaptureState(isActive, error = null) {
      isCaptureActive = isActive;
      console.log(`Updating UI - Capture Active: ${isCaptureActive}, Error: ${error}`);

      // Add/remove class to main container for state-specific styling
      uiContainer.classList.toggle('recording-active', isActive);

      startCaptureButton.classList.toggle('hidden', isActive);
      startCaptureButton.disabled = false; // Re-enable unless starting

      previewContainer.classList.toggle('hidden', !isActive);
      recordingControls.classList.toggle('hidden', !isActive);
      stopCaptureButton.disabled = false; // Re-enable unless stopping

      if (!isActive) {
          predictionDisplay.textContent = 'No Basketball'; // Reset text on stop
          predictionDisplay.classList.remove('prediction-basketball'); // Ensure accent class is removed
          // Clear preview canvas
          previewCtx.fillStyle = '#1a1f2c'; // Match new background
          previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
      }

      // Update status message visibility and content
      if (isActive) {
          // statusMessage.textContent = 'Recording...'; // Content not needed
          statusMessage.classList.add('hidden'); // Hide during active recording
      } else if (error) {
          statusMessage.textContent = `Error: ${error}`;
          statusMessage.style.color = '#FFB74D'; // Use warning color for errors
          statusMessage.classList.remove('hidden'); // Show errors
      } else {
          statusMessage.textContent = ''; // Clear status when idle
          statusMessage.classList.add('hidden'); // Hide when idle and no error
          statusMessage.style.color = ''; // Reset color
      }
  }

  // --- Toggle Overlay Visibility ---
  function toggleOverlay(forceShow) {
      const shouldShow = forceShow !== undefined ? forceShow : uiContainer.classList.contains('hidden');
      console.log(`toggleOverlay called. Current hidden: ${uiContainer.classList.contains('hidden')}, shouldShow: ${shouldShow}`);

      if (shouldShow) {
          uiContainer.classList.remove('hidden');
          console.log(`Overlay should be visible.`);
          if (isPageRestricted) {
              console.log(`Page is restricted. Showing message.`);
              startCaptureButton.classList.add('hidden');
              previewContainer.classList.add('hidden');
              recordingControls.classList.add('hidden');
              closeButton.classList.add('hidden');
              dragHandle.classList.add('hidden');
              restrictedMessageDiv.classList.remove('hidden');
          } else {
              console.log(`Page not restricted. Updating UI state.`);
              restrictedMessageDiv.classList.add('hidden');
              closeButton.classList.remove('hidden');
              dragHandle.classList.remove('hidden');
              updateUIForCaptureState(isCaptureActive);
          }
      } else {
          console.log(`Overlay should be hidden.`);
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
  let initialLeft = window.innerWidth - 250 - initialPadding;
  let initialTop = window.innerHeight - 150 - initialPadding;
  if (initialLeft < 0) initialLeft = initialPadding;
  if (initialTop < 0) initialTop = initialPadding;
  xOffset = initialLeft;
  yOffset = initialTop;
  setTranslate(initialLeft, initialTop, uiContainer);

  // Set initial element visibility based on page restriction
  if (isPageRestricted) {
      startCaptureButton.classList.add('hidden');
      previewContainer.classList.add('hidden');
      recordingControls.classList.add('hidden');
      closeButton.classList.add('hidden');
      dragHandle.classList.add('hidden');
      restrictedMessageDiv.classList.add('hidden');
  } else {
      restrictedMessageDiv.classList.add('hidden');
      updateUIForCaptureState(false);
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