# Basketball Classifier Chrome Extension

This Chrome extension uses an AI model to detect basketball content in web pages and provides a floating overlay with real-time classification results.

## Features

- **Real-time Classification**: Detects basketball content on web pages in real-time
- **Confidence-Based Prediction**: High confidence predictions have more influence than uncertain ones
- **History Tracking**: Uses recent classification results to provide stable predictions
- **Temporal Consensus System**: Uses a weighted voting system across multiple frames to reduce fluctuations
- **Volume Control**: Automatically adjusts volume based on content detection
- **Customizable Settings**: Adjust scene sensitivity and enable/disable volume control

## Installation

### Development Mode

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top-right corner
4. Click "Load unpacked" and select the extension directory
5. The Basketball Classifier extension should now appear in your extensions list

## Usage

1. Click on the Basketball Classifier extension icon in your Chrome toolbar
2. Click "Start Overlay" to activate the classifier on the current tab
3. The overlay will appear in the top-right corner of the page
4. Click the play button (▶) in the overlay to start classification
5. The overlay will show "BASKETBALL" or "NOT BASKETBALL" with confidence percentage
6. Click the pause button (‖) to stop classification
7. Click the X button to close the overlay

## Settings

- **Scene Sensitivity**: Controls how much change between frames is required to trigger a new classification (higher = less sensitive)
- **Enable volume control**: When enabled, the extension will automatically lower volume for non-basketball content

## Technical Details

- Uses a quantized ONNX model for efficient basketball content classification
- Implements a temporal consensus system similar to the desktop application
- Processes frames only when significant visual changes are detected
- Uses Web Audio API for volume control

## Requirements

- Chrome browser (version 80 or later)
- Webpage permissions to access page content and audio control

## Privacy

- All processing happens locally in your browser
- No data is sent to external servers
- The extension only activates on tabs where you explicitly enable it

## License

This project is licensed under the MIT License - see the LICENSE file for details. 