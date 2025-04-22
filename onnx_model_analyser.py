import os
import sys
import time
import numpy as np
# import tensorflow as tf  # Need TF just for preprocessing
import random
from pathlib import Path
import onnxruntime as ort
from PIL import Image

def preprocess_image_no_tf(file_path, target_size=224):
    try:
        img = Image.open(file_path)
        img = img.convert('RGB')

        if hasattr(Image, 'Resampling'):
            interpolation = Image.Resampling.BILINEAR
        else:
            interpolation = Image.BILINEAR
        img = img.resize((target_size, target_size), interpolation)

        img_array = np.array(img)
        img_array = img_array.astype(np.float32)

        return img_array

    except FileNotFoundError:
        print(f"Error: File not found at {file_path}")
        return None
    except Exception as e:
        print(f"Error processing image {file_path}: {e}")
        return None


def get_sample_data(data_dir, n_samples=10, target_size=224):
    """Get n_samples from both basketball and non-basketball frames."""
    basketball_dir = os.path.join(data_dir, "Basketball_Game_Frames")
    non_basketball_dir = os.path.join(data_dir, "Not_Basketball_Game_Frames")
    
    basketball_files = []
    for subdir, _, files in os.walk(basketball_dir):
        for file in files:
            if file.lower().endswith((".png", ".jpg", ".jpeg")):
                basketball_files.append(os.path.join(subdir, file))
    
    non_basketball_files = []
    for subdir, _, files in os.walk(non_basketball_dir):
        for file in files:
            if file.lower().endswith((".png", ".jpg", ".jpeg")):
                non_basketball_files.append(os.path.join(subdir, file))
    
    # Randomly select n_samples from each category
    if len(basketball_files) < n_samples:
        print(f"Warning: Only {len(basketball_files)} basketball samples available.")
        basketball_samples = basketball_files
    else:
        basketball_samples = random.sample(basketball_files, n_samples)
    
    if len(non_basketball_files) < n_samples:
        print(f"Warning: Only {len(non_basketball_files)} non-basketball samples available.")
        non_basketball_samples = non_basketball_files
    else:
        non_basketball_samples = random.sample(non_basketball_files, n_samples)
    
    # Create arrays to hold sample data and labels
    all_samples = basketball_samples + non_basketball_samples
    all_labels = [1] * len(basketball_samples) + [0] * len(non_basketball_samples)
    
    # Preprocess the images
    preprocessed_images = []
    for path in all_samples:
        img = preprocess_image_no_tf(path, target_size)
        preprocessed_images.append(img)
    
    # Stack images into a batch using NumPy
    batch_images = np.stack(preprocessed_images, axis=0)
    
    return batch_images, np.array(all_labels), all_samples

def load_onnx_model(model_path):
    """Load ONNX model."""
    try:
        print(f"Loading ONNX model from {model_path}...")
        # Create ONNX inference session
        sess_options = ort.SessionOptions()
        sess_options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        
        # Check for GPU support
        providers = ['CUDAExecutionProvider', 'CPUExecutionProvider']
        session = ort.InferenceSession(model_path, sess_options, providers=providers)
        
        # Check if GPU is being used
        if 'CUDAExecutionProvider' in session.get_providers():
            print("ONNX model will use GPU for inference")
        else:
            print("ONNX model will use CPU for inference")
            
        print("ONNX model loaded successfully")
        return session
    except Exception as e:
        print(f"Error loading ONNX model: {e}")
        return None

def predict_onnx(session, images):
    """Run prediction with ONNX model."""
    try:
        # Get model inputs
        input_name = session.get_inputs()[0].name
        
        # Ensure correct data type for ONNX
        images_np = images.astype(np.float32)
        
        # Time the inference
        start_time = time.time()
        predictions = session.run(None, {input_name: images_np})[0]
        end_time = time.time()
        
        return predictions, end_time - start_time
    except Exception as e:
        print(f"Error predicting with ONNX model: {e}")
        return None, 0

def find_data_dir():
    """Find the data directory with basketball images."""
    # Try common locations
    possible_paths = [
        "data/downloaded_videos",
        "../data/downloaded_videos",
        "../../data/downloaded_videos",
        "./data/downloaded_videos",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data/downloaded_videos"),
        "data",
        "../data",
        "../../data",
        "./data",
        os.path.join(os.path.dirname(os.path.abspath(__file__)), "../../data"),
    ]
    
    for path in possible_paths:
        if os.path.exists(path):
            basketball_dir = os.path.join(path, "Basketball_Game_Frames")
            non_basketball_dir = os.path.join(path, "Not_Basketball_Game_Frames")
            
            if os.path.exists(basketball_dir) and os.path.exists(non_basketball_dir):
                return os.path.abspath(path)
    
    print("Data directory not found! Please specify the path to data directory.")
    return None

def analyze_onnx_model(model_path, n_samples=10, target_size=224):
    """Analyze ONNX model performance and accuracy."""
    # Find data directory
    data_dir = find_data_dir()
    if data_dir is None:
        print("Could not find data directory")
        return
    
    print(f"Found data directory: {data_dir}")
    
    # Load ONNX model
    model = load_onnx_model(model_path)
    if not model:
        print("Failed to load ONNX model. Exiting.")
        return
    
    # Get sample data
    images, labels, file_paths = get_sample_data(data_dir, n_samples, target_size)
    
    print(f"\nRunning inference on {len(images)} samples ({n_samples} basketball, {n_samples} non-basketball)...")
    
    # Run predictions
    predictions, inference_time = predict_onnx(model, images)
    if predictions is None:
        print("Prediction failed. Exiting.")
        return
    
    avg_time_per_sample = inference_time / len(images)
    print(f"ONNX inference time: {inference_time:.4f}s ({avg_time_per_sample*1000:.2f}ms per sample)")
    
    # Calculate accuracy metrics
    correct_count = 0
    basketball_correct = 0
    non_basketball_correct = 0
    basketball_total = 0
    non_basketball_total = 0
    
    # Store predictions for analysis
    all_predictions = []
    
    for i in range(len(images)):
        pred_value = float(predictions[i][0])
        pred_class = pred_value > 0.5
        true_class = labels[i] == 1
        all_predictions.append((pred_value, true_class))
        
        # Count correct predictions
        if pred_class == true_class:
            correct_count += 1
            if true_class:
                basketball_correct += 1
            else:
                non_basketball_correct += 1
        
        # Count class totals
        if true_class:
            basketball_total += 1
        else:
            non_basketball_total += 1
    
    # Print individual sample results in a more concise format
    print("\n" + "="*50)
    print("SAMPLE PREDICTIONS")
    print("="*50)
    print(f"{'#':<4} {'Filename':<30} {'True':<15} {'Pred':<15} {'Score':<10} {'Result'}")
    print("-"*80)
    
    for i in range(len(images)):
        pred = predictions[i][0]
        pred_class = pred > 0.5
        true_class = labels[i] == 1
        correct = pred_class == true_class
        
        # Format for concise one-line display
        file_name = os.path.basename(file_paths[i])
        true_label = "Basketball" if true_class else "Not Basketball"
        pred_label = "Basketball" if pred_class else "Not Basketball"
        result = "✓" if correct else "✗"
        
        print(f"{i+1:<4} {file_name:<30} {true_label:<15} {pred_label:<15} {pred:.6f}  {result}")
    
    # Print accuracy metrics
    print("\n" + "="*50)
    print("ACCURACY ANALYSIS")
    print("="*50)
    
    # Overall accuracy
    overall_accuracy = correct_count / len(images) if len(images) > 0 else 0
    print(f"Overall accuracy: {overall_accuracy:.2%} ({correct_count}/{len(images)})")
    
    # Class-specific accuracy
    basketball_accuracy = basketball_correct / basketball_total if basketball_total > 0 else 0
    non_basketball_accuracy = non_basketball_correct / non_basketball_total if non_basketball_total > 0 else 0
    
    print(f"Basketball class accuracy: {basketball_accuracy:.2%} ({basketball_correct}/{basketball_total})")
    print(f"Non-basketball class accuracy: {non_basketball_accuracy:.2%} ({non_basketball_correct}/{non_basketball_total})")
    
    # Confusion counts
    false_positives = non_basketball_total - non_basketball_correct
    false_negatives = basketball_total - basketball_correct
    
    print(f"False positives (non-basketball predicted as basketball): {false_positives}")
    print(f"False negatives (basketball predicted as non-basketball): {false_negatives}")
    
    # Check for high confidence errors
    high_conf_errors = []
    for i, (pred, true_label) in enumerate(all_predictions):
        # High confidence means > 0.9 for positive or < 0.1 for negative predictions
        is_high_conf = (pred > 0.9) or (pred < 0.1)
        is_error = (pred > 0.5) != true_label
        
        if is_high_conf and is_error:
            high_conf_errors.append((i, pred, true_label))
    
    if high_conf_errors:
        print("\nHigh confidence errors:")
        for idx, pred, true_label in high_conf_errors[:3]:  # Show up to 3 examples
            true_class = "Basketball" if true_label else "Not Basketball"
            pred_class = "Basketball" if pred > 0.5 else "Not Basketball"
            print(f"  Sample {idx+1}: {os.path.basename(file_paths[idx])}")
            print(f"    True: {true_class}, Predicted: {pred_class} with {pred:.2%} confidence")
    else:
        print("\nNo high confidence errors found in the sample set.")
    
    # Performance information
    print("\n" + "="*50)
    print("PERFORMANCE ANALYSIS")
    print("="*50)
    print(f"Total inference time: {inference_time:.4f}s")
    print(f"Average time per sample: {avg_time_per_sample*1000:.2f}ms")
    print(f"Samples per second: {1.0/avg_time_per_sample:.1f}")
    
    return {
        "accuracy": overall_accuracy,
        "basketball_accuracy": basketball_accuracy,
        "non_basketball_accuracy": non_basketball_accuracy,
        "inference_time": inference_time,
        "avg_time_per_sample": avg_time_per_sample
    }

def main():
    """Main execution function."""
    print("="*50)
    print("ONNX Model Analyzer")
    print("="*50)
    
    # Parse command line arguments
    import argparse
    parser = argparse.ArgumentParser(description="Analyze ONNX model performance")
    parser.add_argument("--model", type=str, default="models/saved_model/hypernetwork_basketball_classifier.onnx",
                       help="Path to ONNX model file")
    parser.add_argument("--samples", type=int, default=10, 
                       help="Number of samples per class to use for testing")
    parser.add_argument("--target-size", type=int, default=224,
                       help="Input image size for the model")
    
    args = parser.parse_args()
    
    # Run analysis with requested parameters
    analyze_onnx_model(args.model, n_samples=args.samples, target_size=args.target_size)

if __name__ == "__main__":
    main() 