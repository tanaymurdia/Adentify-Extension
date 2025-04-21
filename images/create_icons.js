const fs = require('fs');
const path = require('path');

// Function to create a simple colored square as a placeholder icon
function createPlaceholderIcon(size, color, outputPath) {
  // Create a simple SVG square with the specified color
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="${color}" />
    <circle cx="${size/2}" cy="${size/2}" r="${size/3}" fill="white" />
    <circle cx="${size/2}" cy="${size/2}" r="${size/4}" fill="orange" />
  </svg>`;
  
  fs.writeFileSync(outputPath, svg);
  console.log(`Created icon: ${outputPath}`);
}

// Create placeholder icons in different sizes
createPlaceholderIcon(16, '#4285F4', path.join(__dirname, 'icon16.svg'));
createPlaceholderIcon(48, '#4285F4', path.join(__dirname, 'icon48.svg'));
createPlaceholderIcon(128, '#4285F4', path.join(__dirname, 'icon128.svg'));

console.log('Icon creation complete. Convert SVG to PNG before using in production.'); 