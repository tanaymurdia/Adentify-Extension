const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = {
  entry: {
    popup: './popup.js',
    background: './background.js'
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
  },
  mode: 'production',
  module: {
    rules: [],
  },
  plugins: [
    new CopyPlugin({
      patterns: [
        { from: 'manifest.json', to: '' },
        { from: 'popup.html', to: '' },
        { from: 'images', to: 'images' },
        { from: 'models/*.onnx', to: '' },
        { from: 'node_modules/onnxruntime-web/dist/*.wasm', to: '' },
      ],
    }),
  ],
  resolve: {
    extensions: ['.js'],
  },
  performance: {
    hints: false,
    maxEntrypointSize: 8192000,
    maxAssetSize: 8192000
  }
}; 