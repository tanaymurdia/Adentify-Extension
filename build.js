const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Ensure proper directories exist
if (!fs.existsSync('dist')) {
  fs.mkdirSync('dist');
}

if (!fs.existsSync('dist/images')) {
  fs.mkdirSync('dist/images');
}

// Convert SVG icons to data URLs in a simple HTML file for PNG screenshot
console.log('Converting icons...');

const icons = ['icon16.svg', 'icon48.svg', 'icon128.svg'];
for (const icon of icons) {
  const svg = fs.readFileSync(path.join('images', icon), 'utf8');
  const pngName = icon.replace('.svg', '.png');
  // Since we can't directly convert SVG to PNG in Node.js without additional dependencies,
  // we'll just copy the SVG files for now and instruct users how to convert them
  fs.writeFileSync(path.join('dist/images', pngName), svg);
  console.log(`Created placeholder for ${pngName} (manual conversion needed)`);
}

// Copy the ONNX model
console.log('Copying model file...');
if (fs.existsSync('models/hypernetwork_basketball_classifier_quantized.onnx')) {
  if (!fs.existsSync('dist/models')) {
    fs.mkdirSync('dist/models');
  }
  fs.copyFileSync(
    'models/hypernetwork_basketball_classifier_quantized.onnx',
    'dist/models/hypernetwork_basketball_classifier_quantized.onnx'
  );
  console.log('Model file copied successfully');
} else {
  console.error('Model file not found!');
  console.log('Please ensure models/hypernetwork_basketball_classifier_quantized.onnx exists');
}

// Run webpack build
console.log('Building extension with webpack...');
try {
  execSync('npx webpack --mode production', { stdio: 'inherit' });
  console.log('Extension built successfully in dist/ directory');
} catch (error) {
  console.error('Error building extension:', error);
}

console.log('\nBuild complete!');
console.log('To load the extension in Chrome:');
console.log('1. Open Chrome and go to chrome://extensions/');
console.log('2. Enable "Developer mode"');
console.log('3. Click "Load unpacked" and select the dist/ directory');
console.log('\nNote: You may need to properly convert the SVG icons to PNG files before using in production'); 