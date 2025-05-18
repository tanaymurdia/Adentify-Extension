# Adentify Extension

A Chrome extension leveraging machine learning to enhance basketball viewing experiences through intelligent content recognition.

## Overview

Adentify is a Chrome extension that employs machine learning to recognize basketball content in video streams. By identifying basketball scenes in real-time, Adentify enhances viewing experiences through features such as automated audio management and dynamic tab switching. The extension processes video content locally, ensuring privacy while delivering responsive performance.

## Key Features

- **Basketball Content Detection**: Utilizes a neural network model to identify basketball content with high accuracy
- **Adaptive Audio Management**: Automatically adjusts audio levels based on content classification with configurable debouncing
- **Intelligent Tab Management**: Switches between content sources based on content type with stability mechanisms
- **Visual Preview**: Provides a preview window with current classification status
- **Scene Change Detection**: Employs computer vision techniques to identify content transitions

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/tanaymurdia/Adentify-Extension.git
   ```

2. Install dependencies:
   ```bash
   cd Adentify-Extension
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load the extension in Chrome:
   - Navigate to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked" and select the `dist` directory from your project

### Development Environment

For development with hot reloading:
```bash
npm run dev
```

## Usage

1. Click the Adentify icon in your Chrome toolbar to open the launcher
2. Select "Start Adentifying" to initiate capture on the current tab
3. The extension will begin analyzing and responding to content
4. Access configuration via the settings menu (gear icon):
   - **Adaptive Sound**: Configure automatic audio management
   - **Tab Switching**: Enable/disable automatic content source switching
   - **Fallback Tab**: Select alternative content source for non-basketball content
   - **Scene Detection Sensitivity**: Adjust detection threshold parameters

## Technical Architecture

### Core Components

1. **Background Service Worker**
   - Orchestrates extension lifecycle and component communication
   - Manages capture permissions and media stream initialization
   - Implements audio control with debouncing mechanisms
   - Handles tab switching with stability parameters

2. **Offscreen Document**
   - Processes video captures using Chrome's Offscreen API
   - Implements scene change detection algorithms
   - Handles frame extraction and preprocessing for model inference
   - Maintains communication with the neural network worker

3. **ONNX Neural Network Worker**
   - Executes model inference in an isolated thread for performance optimization
   - Implements temporal classification with smoothing techniques
   - Identifies commercial segments through pattern recognition
   - Optimizes resource usage through efficient processing

4. **User Interface Layer**
   - Provides an intuitive control interface
   - Displays classification status and preview frames
   - Offers configuration options
   - Implements responsive design patterns

### Technical Implementation Details

- **Chrome Manifest V3**: Utilizes the latest extension architecture for security and performance
- **Debouncing Systems**: Implements debouncing for audio control and tab switching to prevent oscillation
- **Multi-threaded Processing**: Isolates computation-intensive tasks in dedicated web workers
- **ONNX Runtime**: Employs cross-platform inference engine for model execution
- **Optimized ML Model**: Uses quantized neural network for efficient inference

## ML Model Architecture

Adentify employs a deep learning architecture designed for binary image classification of basketball versus non-basketball content. The model combines:

- **EfficientNetV2B0** as a partially frozen feature extractor
- **Low-rank hypernetwork** generating per-frame parameter adaptations
- Performance optimizations including quantization for browser deployment

### Performance Characteristics

The Adentify machine learning model offers an effective combination of accuracy, efficiency, and size optimization:

#### Accuracy Metrics
- **High classification accuracy** across diverse basketball content types
- **Consistent performance** across varying lighting conditions and camera angles
- **Temporal stability** through frame sequence analysis to reduce misclassifications
- **Commercial content detection** to distinguish between game content and advertisements

#### Efficiency Considerations
- **Fast inference time** enabling real-time processing on consumer hardware
- **Reduced computational requirements** compared to standard CNN classifiers
- **Optimized resource utilization** during extended viewing sessions
- **Efficient processing** to minimize battery impact on mobile devices

#### Size Optimization
- **Compact model size** (6.6MB) after quantization
- **Significant parameter reduction** through hypernetwork architecture and low-rank adaptations
- **Browser-compatible implementation** without requiring specialized hardware
- **Minimal memory footprint** during operation

This technical approach enables content analysis directly in the browser environment while maintaining performance within the constraints of client-side processing.

### Research Foundations

The model architecture builds upon research in multiple domains:

#### EfficientNetV2 for Feature Extraction
- Leverages EfficientNetV2's Fused-MBConv and compound scaling for efficient visual feature extraction
- Implemented with 80% frozen layers to maintain robust feature representation while reducing computational requirements

#### Hypernetworks for Dynamic Adaptation
- Utilizes the hypernetwork paradigm to generate custom Dense layer weights for each video frame
- Provides dynamic adaptation to varying visual conditions and content variations

#### Low-Rank Modulation
- Implements LoRA-style parameter optimization to reduce memory footprint while maintaining performance
- Constrains hypernetwork-generated updates to low-rank representations for efficiency

#### Engineering Optimizations
- Employs mixed-precision and quantization techniques to optimize for browser-based execution
- Includes optimizations for memory efficiency and inference speed

### Unique Architecture Benefits

The custom model architecture offers several advantages:

| Component | Implementation Advantage |
|-----------|--------------------------|
| EfficientNetV2 | Used with frozen layers and adapter-only updates for efficient transfer learning |
| Hypernetwork Design | Optimized for per-frame weight modulation of Dense layers |
| Low-Rank Adapter | Combined with hypernetwork for efficient, dynamic adaptation |
| Quantization | INT8 quantization for browser deployment with minimal performance impact |

## Future Development Roadmap

- [ ] **Multi-sport Recognition**: Extend classification capabilities to additional sports
- [ ] **Personalization Framework**: Implement user profiles with customizable detection parameters
- [ ] **Streaming Platform Integration**: Develop dedicated support for major streaming services
- [ ] **Cross-platform Expansion**: Create mobile versions for Android and iOS platforms
- [ ] **Multi-view Capabilities**: Develop picture-in-picture functionality for multiple game viewing
- [ ] **Statistics Integration**: Implement overlay system for game statistics

## Technical Requirements

- Chrome Browser (version 92 or later)
- Required Permissions:
  - Tab capture
  - Offscreen document
  - Audio control

## Privacy and Security

Adentify processes all video content locally on your device. No video data or analysis results are transmitted to external servers. The machine learning model operates entirely within your browser, ensuring privacy during content analysis.

## License

[MIT License](LICENSE)

## Acknowledgments

- Basketball detection model architecture based on hypernetwork research and EfficientNetV2
- ONNX Runtime Web for efficient ML inference in browser environments
- Chrome Extensions API for web integration capabilities 
