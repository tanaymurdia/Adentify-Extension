const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');

module.exports = {
  entry: {
    background: './background.js',
    content_script: './content_script.js',
    offscreen: './offscreen.js',
    launcher: './launcher.js',
    onnx_worker: './onnx_worker.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].bundle.js', // Output bundled files as background.bundle.js, etc.
  },
  module: {
    // We don't have specific loaders yet (like Babel or TypeScript)
    // Add rules here later if needed
    rules: [],
  },
  plugins: [
    new CleanWebpackPlugin(),
    new CopyWebpackPlugin({
      patterns: [
        { from: 'manifest.json', to: '.' },
        { from: 'offscreen.html', to: '.' },
        { from: 'launcher.html', to: '.' },
        { from: 'overlay.css', to: '.' },
        { from: 'icon128.png', to: '.' },
        { from: 'overlay.js', to: '.' }
      ],
    }),
  ],
  mode: 'production', // Default mode, can be overridden by command line
  // Optional: Disable devtool for production builds to reduce size
  // devtool: process.env.NODE_ENV === 'production' ? false : 'cheap-module-source-map',
}; 