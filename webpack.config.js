const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const { CleanWebpackPlugin } = require('clean-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');

module.exports = (env, argv) => {
  const isProduction = argv.mode === 'production';
  
  return {
    entry: {
      background: './src/js/background.js',
      offscreen: './src/js/offscreen.js',
      launcher: './src/js/launcher.js',
      onnx_worker: './src/js/onnx_worker.js',
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
          { from: 'src/manifest.json', to: '.' },
          { from: 'src/html/offscreen.html', to: '.' },
          { from: 'src/html/launcher.html', to: '.' },
          { from: 'src/launcher.css', to: '.' },
          { from: 'src/js/cast/cast_helpers.js', to: 'cast' },
          { from: 'src/js/cast/cast_framework.js', to: 'cast' },
          // Copy ONNX Runtime WASM files and the main library
          { 
            from: 'node_modules/onnxruntime-web/dist/*.wasm',
            to: 'wasm/[name][ext]' // Copy WASM files to a 'wasm' subdirectory
          },
          {
            from: 'node_modules/onnxruntime-web/dist/*.jsep.mjs',
            to: 'wasm/[name][ext]' // Copy JSEP helper to the same wasm directory
          },
          {
            from: 'node_modules/onnxruntime-web/dist/ort.min.js',
            to: '.' // Copy the main library file to the root of dist
          },
          {
            from: 'src/models/hypernetwork_basketball_classifier_quantized.onnx',
            to: 'models/[name][ext]' // Copy to dist/models/
          },
          // Copy popup assets (e.g. adentify-icon.png)
          { from: 'src/assets', to: 'assets' },
        ],
      }),
    ],
    mode: argv.mode || 'production', // Default mode, can be overridden by command line
    // Optional: Disable devtool for production builds to reduce size
    devtool: isProduction ? false : 'cheap-module-source-map',
    optimization: {
      minimize: isProduction,
      minimizer: [
        new TerserPlugin({
          terserOptions: {
            compress: {
              drop_console: true, // Removes console.* calls
              pure_funcs: ['console.log', 'console.debug', 'console.info'], // Alternative approach to remove specific console methods
            },
          },
        }),
      ],
      usedExports: true,
      // Add code splitting configuration
      splitChunks: {
        chunks: 'all',
        maxInitialRequests: Infinity,
        minSize: 0,
        cacheGroups: {
          vendor: {
            test: /[\\/]node_modules[\\/]/,
            name(module) {
              const packageName = module.context.match(/[\\/]node_modules[\\/](.*?)([\\/]|$)/)[1];
              return `vendor.${packageName.replace('@', '')}`;
            },
          },
        },
      },
    },
    performance: {
      hints: false,
    },
  };
}; 