// Background script for Basketball Classifier Extension

// Log when the extension is installed
chrome.runtime.onInstalled.addListener(() => {
  console.log("Basketball Image Classifier extension installed");
});

// Make sure ONNX model files are accessible
chrome.runtime.getPackageDirectoryEntry(function(root) {
  root.getDirectory("models", {create: false}, function(modelsDir) {
    modelsDir.getFile("hypernetwork_basketball_classifier_quantized.onnx", {create: false}, function(fileEntry) {
      console.log("ONNX model file found");
    }, function(error) {
      console.error("ONNX model file not found:", error);
    });
  }, function(error) {
    console.error("Models directory not found:", error);
  });
}); 