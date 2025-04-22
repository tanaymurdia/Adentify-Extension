console.log("Content script loaded.");

// --- UI Elements ---
const uiContainer = document.createElement('div');
const toolbar = document.createElement('div');
const previewContainer = document.createElement('div'); // Container for preview
const previewCanvas = document.createElement('canvas'); // Canvas for showing preview
const previewCtx = previewCanvas.getContext('2d');
const captureTypeSelect = document.createElement('select'); // Dropdown for capture type
const startCaptureButton = document.createElement('button');
const stopCaptureButton = document.createElement('button');
const statusMessage = document.createElement('span'); // For messages like "Recording..."
const restrictedMessageDiv = document.createElement('div'); // New element for restriction message

// --- State ---
let isCaptureActive = false;
let isOverlayVisible = false;
let isPageRestricted = false; // New state variable
let lastFrameTime = 0;
const FRAME_RATE_LIMIT = 15; // Target FPS for preview (limit requests)

// --- Setup UI Container ---
uiContainer.id = 'adentify-ui';
uiContainer.style.position = 'fixed';
uiContainer.style.bottom = '20px'; // Position toolbar/preview area
uiContainer.style.right = '20px';
uiContainer.style.zIndex = '999999';
uiContainer.style.pointerEvents = 'none'; // Pass clicks through container by default
uiContainer.style.display = 'none'; // Keep it initially hidden
uiContainer.style.background = 'rgba(40, 40, 40, 0.85)';
uiContainer.style.color = 'white';
uiContainer.style.padding = '10px';
uiContainer.style.borderRadius = '8px';
uiContainer.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.3)';
document.body.appendChild(uiContainer);

// --- Setup Toolbar ---
toolbar.id = 'adentify-toolbar';
toolbar.style.display = 'flex';
toolbar.style.gap = '10px';
toolbar.style.alignItems = 'center';
toolbar.style.pointerEvents = 'auto'; // Toolbar elements are interactive
uiContainer.appendChild(toolbar);

// --- Setup Preview Area ---
previewContainer.id = 'adentify-preview';
previewContainer.style.marginTop = '10px';
previewContainer.style.display = 'none'; // Hidden until recording starts
previewContainer.style.pointerEvents = 'none'; // Preview itself is not interactive
previewCanvas.id = 'adentify-preview-canvas';
previewCanvas.width = 320; // Example preview size
previewCanvas.height = 180;
previewCanvas.style.border = '1px solid #666';
previewCanvas.style.display = 'block'; // Canvas is block element
previewContainer.appendChild(previewCanvas);
uiContainer.appendChild(previewContainer);

// --- NEW: Setup Restriction Message Div ---
restrictedMessageDiv.id = 'adentify-restricted-msg';
restrictedMessageDiv.textContent = 'Adentify cannot run on this page.';
restrictedMessageDiv.style.padding = '10px';
restrictedMessageDiv.style.textAlign = 'center';
restrictedMessageDiv.style.fontStyle = 'italic';
restrictedMessageDiv.style.display = 'none'; // Hide initially
restrictedMessageDiv.style.pointerEvents = 'auto'; // Allow interaction if needed later
uiContainer.appendChild(restrictedMessageDiv);

// --- Setup Toolbar Elements ---
function styleButton(button, text) {
    button.textContent = text;
    button.style.background = '#555';
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.padding = '5px 10px';
    button.style.borderRadius = '5px';
    button.style.cursor = 'pointer';
    button.style.fontFamily = 'sans-serif';
}

// Capture Type Dropdown
const options = [
    { value: 'tab', text: 'Current Tab' },
    { value: 'desktop', text: 'Desktop/Window' }
];
options.forEach(optData => {
    const option = document.createElement('option');
    option.value = optData.value;
    option.textContent = optData.text;
    captureTypeSelect.appendChild(option);
});
captureTypeSelect.id = 'capture-type-select';
captureTypeSelect.style.background = '#555';
captureTypeSelect.style.color = 'white';
captureTypeSelect.style.border = 'none';
captureTypeSelect.style.padding = '5px';
captureTypeSelect.style.borderRadius = '5px';
toolbar.appendChild(captureTypeSelect);

// Start Capture Button
styleButton(startCaptureButton, 'Start');
startCaptureButton.id = 'start-capture-btn';
startCaptureButton.addEventListener('click', () => {
    const selectedType = captureTypeSelect.value;
    console.log(`Start Capture clicked, type: ${selectedType}`);
    if (selectedType === 'tab') {
        chrome.runtime.sendMessage({ type: 'request-start-tab-capture' });
    } else {
        // Request background script to open the desktop/window picker
        chrome.runtime.sendMessage({ type: 'request-start-capture' });
    }
    // Disable UI temporarily while starting
    startCaptureButton.disabled = true;
    captureTypeSelect.disabled = true;
    statusMessage.textContent = 'Starting...';
});
toolbar.appendChild(startCaptureButton);

// Stop Capture Button
styleButton(stopCaptureButton, 'Stop');
stopCaptureButton.id = 'stop-capture-btn';
stopCaptureButton.addEventListener('click', () => {
    console.log("Stop Capture button clicked");
    chrome.runtime.sendMessage({ type: 'request-stop-capture' });
    // Disable button temporarily
    stopCaptureButton.disabled = true;
    statusMessage.textContent = 'Stopping...';
});
toolbar.appendChild(stopCaptureButton);

// Status Message Area
statusMessage.id = 'adentify-status';
statusMessage.style.marginLeft = '10px';
statusMessage.style.fontStyle = 'italic';
toolbar.appendChild(statusMessage);

// --- Update UI based on capture state ---
function updateUIForCaptureState(isActive, error = null) {
    isCaptureActive = isActive;
    console.log(`Updating UI - Capture Active: ${isCaptureActive}, Error: ${error}`);

    // Toggle visibility/enabled state WITHIN the toolbar
    startCaptureButton.style.display = isActive ? 'none' : 'inline-block';
    startCaptureButton.disabled = false;
    captureTypeSelect.style.display = isActive ? 'none' : 'inline-block';
    captureTypeSelect.disabled = false;

    stopCaptureButton.style.display = isActive ? 'inline-block' : 'none';
    stopCaptureButton.disabled = false;

    // Show/hide preview container (managed alongside toolbar visibility)
    previewContainer.style.display = isActive ? 'block' : 'none';

    // Update status message
    if (isActive) {
        statusMessage.textContent = 'Recording...';
    } else if (error) {
        statusMessage.textContent = `Error: ${error}`;
    } else {
        statusMessage.textContent = ''; // Clear status when idle
    }

    // Clear canvas if capture stops
    if (!isActive) {
        previewCtx.fillStyle = '#333';
        previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    }
}

// --- Toggle Overlay Visibility ---
function toggleOverlay(show) {
    if (show === undefined) {
        isOverlayVisible = !isOverlayVisible;
    } else {
        isOverlayVisible = show;
    }
    uiContainer.style.display = isOverlayVisible ? 'block' : 'none';
    console.log(`Overlay visibility set to: ${isOverlayVisible}`);

    if (isPageRestricted) {
        toolbar.style.display = 'none';
        previewContainer.style.display = 'none';
        restrictedMessageDiv.style.display = isOverlayVisible ? 'block' : 'none';
    } else {
        // Page is not restricted
        restrictedMessageDiv.style.display = 'none';
        if (isOverlayVisible) {
            // Show the toolbar and update its contents
            toolbar.style.display = 'flex'; // Explicitly show toolbar
            updateUIForCaptureState(isCaptureActive); // Update Start/Stop buttons and Preview
        } else {
            // Hide toolbar and preview when overlay is hidden
            toolbar.style.display = 'none';
            previewContainer.style.display = 'none';
        }
    }
}

// --- Handle Preview Frame ---
function drawPreviewFrame(dataUrl) {
    const now = performance.now();
    // Throttle drawing to avoid blocking the main thread too much
    if (now - lastFrameTime < (1000 / FRAME_RATE_LIMIT)) {
        return; // Skip frame
    }
    lastFrameTime = now;

    const img = new Image();
    img.onload = () => {
        // Scale image to fit canvas while maintaining aspect ratio
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
        // Optionally draw an error indicator on the canvas
        previewCtx.fillStyle = 'red';
        previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
    };
    img.src = dataUrl;
}

// --- Add log before listener ---
console.log("Content script: Attempting to add message listener...");

// --- Message Listener from Background ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // --- Add log inside listener ---
  console.log("Content script: Received message type:", message.type);

  let needsResponse = false;
  switch (message.type) {
    // Changed from show-initial-overlay
    case 'toggle-overlay':
        console.log("Message received: toggle-overlay");
        toggleOverlay(); // Toggle visibility
        break;
    case 'capture-state-active':
        console.log("Message received: capture-state-active");
        updateUIForCaptureState(true);
        // Ensure overlay is visible when capture starts
        toggleOverlay(true);
        break;
    case 'capture-state-inactive':
        console.log("Message received: capture-state-inactive");
        const errorMsg = message.payload?.error;
        updateUIForCaptureState(false, errorMsg);
        // Keep overlay visible after stopping (user might want to restart)
        toggleOverlay(true);
        break;
     // NEW: Handle preview frame
    case 'preview-frame':
        // console.log("Message received: preview-frame"); // Too noisy
        if (isCaptureActive && message.payload?.frameDataUrl) {
            drawPreviewFrame(message.payload.frameDataUrl);
        }
        break;
  }
  return needsResponse; // Return true if sendResponse is used asynchronously
});

// --- Add log AFTER listener setup ---
console.log("Content script: Message listener ADDED.");

// --- Optional: Inject CSS --- (remains the same)
const style = document.createElement('style');
style.textContent = `
  #adentify-toolbar button:hover,
  #adentify-toolbar select:hover {
    background-color: #444;
  }
   #adentify-toolbar button:disabled,
   #adentify-toolbar select:disabled {
    opacity: 0.5;
    cursor: not-allowed;
   }
`;
document.head.appendChild(style);

console.log("Content script initialized with overlay UI.");
// Set initial state (hidden, inactive)
updateUIForCaptureState(false);
toggleOverlay(false); // Start hidden

// --- Initial Setup and Page Check ---
console.log("Content script initialized.");

// Check if the page is restricted
const currentUrl = window.location.href;
const currentHostname = window.location.hostname;
if (currentUrl.startsWith('chrome:') || currentHostname === 'chrome.google.com') {
    console.warn("Content script running on a restricted page.");
    isPageRestricted = true;
} else {
    console.log("Content script running on a standard page.");
    isPageRestricted = false;
}

// Set initial state
if (isPageRestricted) {
    toolbar.style.display = 'none'; // Ensure toolbar is hidden
    previewContainer.style.display = 'none';
} else {
    updateUIForCaptureState(false); // Setup initial button state
}
toggleOverlay(false); // Start hidden 