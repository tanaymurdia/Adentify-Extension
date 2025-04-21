# Basketball Image Classifier Chrome Extension

This Chrome extension uses a machine learning model (ONNX) to classify whether an image contains basketball content or not.

## Features

- Upload and instantly classify images
- Uses an optimized ONNX model for efficient inference
- Real-time processing directly in the browser using WebAssembly

## Installation

### Development Mode

1. Clone this repository:
```bash
git clone https://github.com/yourusername/basketball-classifier-extension.git
cd basketball-classifier-extension
```

2. Install dependencies:
```bash
npm install
```

3. Load the extension in Chrome:
   - Open Chrome and navigate to `chrome://extensions/`
   - Enable "Developer mode" (toggle in the top-right corner)
   - Click "Load unpacked" and select the directory of this repository

## Usage

1. Click on the extension icon in your Chrome toolbar
2. Click "Upload Image" and select an image file from your computer
3. The extension will process the image and display whether it contains basketball content or not
4. The confidence score will also be displayed

## Technical Details

- The extension uses a quantized ONNX model located in `models/hypernetwork_basketball_classifier_quantized.onnx`
- Image preprocessing is performed in JavaScript to match the Python implementation:
  - Resizing to 224x224 pixels
  - Converting to RGB format
  - Normalizing pixel values
- Inference is performed using the onnxruntime-web library

## Development

The extension consists of:
- `manifest.json`: Extension configuration
- `popup.html/js`: User interface and interaction logic
- `background.js`: Background script for extension management

## License

MIT License 