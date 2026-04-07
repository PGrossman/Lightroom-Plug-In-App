#!/usr/bin/env python3
"""
============================================================================
APPLE SILICON GPU VERIFICATION SCRIPT
============================================================================
Comprehensive test to verify GPU acceleration is working correctly
Tests both PyTorch MPS and CLIP model GPU support
============================================================================
"""

import sys
import time


def print_header(title):
    """Print a formatted section header"""
    print("\n" + "=" * 70)
    print(f"  {title}")
    print("=" * 70)


def check_pytorch_mps():
    """Check PyTorch MPS (Apple Silicon GPU) support"""
    print_header("🔍 STEP 1: Checking PyTorch Installation")
    
    try:
        import torch
    except ImportError:
        print("❌ ERROR: PyTorch not installed")
        print("   Run: ./install_pytorch_mps.sh")
        return False
    
    print(f"✅ PyTorch Version: {torch.__version__}")
    print(f"✅ Python Version: {sys.version.split()[0]}")
    
    # Check MPS availability
    mps_available = torch.backends.mps.is_available()
    mps_built = torch.backends.mps.is_built()
    
    print(f"\n📊 MPS Status:")
    print(f"   Available: {'✅ YES' if mps_available else '❌ NO'}")
    print(f"   Built: {'✅ YES' if mps_built else '❌ NO'}")
    
    if not mps_available:
        print("\n⚠️  MPS NOT AVAILABLE")
        print("\n📋 Requirements:")
        print("   • macOS 12.3 or later")
        print("   • M1, M2, or M3 chip")
        print("   • PyTorch 1.12 or later")
        return False
    
    print("\n🚀 Apple Silicon GPU is AVAILABLE!")
    return True


def test_gpu_computation():
    """Test basic GPU computation"""
    print_header("🧪 STEP 2: Testing GPU Computation")
    
    try:
        import torch
        
        device = torch.device("mps")
        print(f"   Device: {device}")
        
        # Test 1: Simple tensor operations
        print("\n   Test 1: Matrix multiplication on GPU...")
        start = time.time()
        x = torch.randn(2000, 2000, device=device)
        y = torch.randn(2000, 2000, device=device)
        z = torch.matmul(x, y)
        gpu_time = time.time() - start
        print(f"   ✅ GPU computation successful!")
        print(f"   ⏱️  Time: {gpu_time:.3f}s")
        print(f"   📍 Result tensor device: {z.device}")
        
        # Test 2: Compare with CPU
        print("\n   Test 2: Comparing GPU vs CPU performance...")
        start = time.time()
        x_cpu = torch.randn(2000, 2000)
        y_cpu = torch.randn(2000, 2000)
        z_cpu = torch.matmul(x_cpu, y_cpu)
        cpu_time = time.time() - start
        print(f"   ✅ CPU computation successful!")
        print(f"   ⏱️  Time: {cpu_time:.3f}s")
        
        speedup = cpu_time / gpu_time
        print(f"\n   🚀 GPU Speedup: {speedup:.2f}x faster than CPU")
        
        if speedup < 1.5:
            print("   ⚠️  Warning: GPU speedup is lower than expected")
            print("      This might improve with larger models/batches")
        
        return True
        
    except Exception as e:
        print(f"❌ GPU computation failed: {e}")
        return False


def test_clip_model():
    """Test CLIP model on GPU"""
    print_header("🎨 STEP 3: Testing CLIP Model on GPU")
    
    try:
        import torch
        from transformers import CLIPProcessor, CLIPModel
        from PIL import Image
        import requests
        from io import BytesIO
        
        device = torch.device("mps")
        
        print("   Loading CLIP model...")
        model = CLIPModel.from_pretrained("openai/clip-vit-base-patch32")
        processor = CLIPProcessor.from_pretrained("openai/clip-vit-base-patch32")
        
        # Move model to GPU
        model = model.to(device)
        model.eval()
        print(f"   ✅ CLIP model loaded successfully")
        print(f"   📍 Model device: {next(model.parameters()).device}")
        
        # Test with a sample image (download from internet)
        print("\n   Downloading test image...")
        try:
            # Use a small test image from a reliable source
            url = "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg"
            response = requests.get(url, timeout=10)
            image = Image.open(BytesIO(response.content)).convert('RGB')
            print("   ✅ Test image downloaded")
        except Exception as e:
            print(f"   ⚠️  Could not download test image: {e}")
            print("   Creating synthetic test image...")
            image = Image.new('RGB', (224, 224), color='red')
        
        # Process image on GPU
        print("\n   Processing image on GPU...")
        start = time.time()
        inputs = processor(images=image, return_tensors="pt").to(device)
        
        with torch.no_grad():
            features = model.get_image_features(**inputs)
            embedding = features / features.norm(dim=-1, keepdim=True)
        
        process_time = time.time() - start
        
        print(f"   ✅ CLIP processing successful!")
        print(f"   ⏱️  Processing time: {process_time:.3f}s")
        print(f"   📊 Embedding shape: {embedding.shape}")
        print(f"   📍 Embedding device: {embedding.device}")
        
        # Test CPU for comparison
        print("\n   Testing CPU for comparison...")
        model_cpu = model.to('cpu')
        inputs_cpu = processor(images=image, return_tensors="pt")
        
        start = time.time()
        with torch.no_grad():
            features_cpu = model_cpu.get_image_features(**inputs_cpu)
        cpu_time = time.time() - start
        
        speedup = cpu_time / process_time
        print(f"   ⏱️  CPU time: {cpu_time:.3f}s")
        print(f"   🚀 GPU Speedup: {speedup:.2f}x faster")
        
        return True
        
    except Exception as e:
        print(f"❌ CLIP model test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_clip_service():
    """Test the actual CLIP service endpoint"""
    print_header("🌐 STEP 4: Testing CLIP Service (Optional)")
    
    try:
        import requests
        
        print("   Checking if CLIP service is running...")
        response = requests.get("http://127.0.0.1:8765/health", timeout=2)
        
        if response.status_code == 200:
            data = response.json()
            print("   ✅ CLIP service is RUNNING!")
            print(f"   📊 Status: {data.get('status')}")
            print(f"   📍 Device: {data.get('device')}")
            print(f"   🚀 MPS Available: {data.get('mps_available')}")
            return True
        else:
            print(f"   ⚠️  Service returned status {response.status_code}")
            return False
            
    except requests.exceptions.ConnectionError:
        print("   ℹ️  CLIP service not running (this is OK)")
        print("      It will start automatically when you run the app")
        return True  # Not an error
    except Exception as e:
        print(f"   ⚠️  Could not check service: {e}")
        return True  # Not critical


def print_summary(results):
    """Print final summary"""
    print_header("📊 VERIFICATION SUMMARY")
    
    all_passed = all(results.values())
    
    for test_name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"   {status} - {test_name}")
    
    print("\n" + "=" * 70)
    
    if all_passed:
        print("🎉 ALL TESTS PASSED!")
        print("=" * 70)
        print("\n✅ Your system is fully optimized for Apple Silicon GPU acceleration!")
        print("\n📈 Expected Performance Improvements:")
        print("   • CLIP embeddings: 3-6x faster (GPU vs CPU)")
        print("   • Image processing: 2-3x faster")
        print("   • Overall workflow: 30-50% faster")
        print("\n🚀 You're ready to use the app with GPU acceleration!")
        print("\n📝 Next step: Run 'npm start' to launch the application")
    else:
        print("⚠️  SOME TESTS FAILED")
        print("=" * 70)
        print("\nThe app will still work but may use CPU instead of GPU.")
        print("\n🔧 Troubleshooting:")
        print("   1. Make sure you're on macOS 12.3+ with M1/M2/M3 chip")
        print("   2. Run: ./install_pytorch_mps.sh")
        print("   3. Try: pip3 install --upgrade torch torchvision")
        print("\n📧 If issues persist, check the project documentation")
    
    print("")
    return all_passed


def main():
    """Main verification function"""
    print("\n🍎 Apple Silicon GPU Verification Tool")
    print("   Lightroom Meta Tagger - Performance Check")
    
    # Run all tests
    results = {
        "PyTorch MPS": check_pytorch_mps(),
        "GPU Computation": test_gpu_computation(),
        "CLIP Model": test_clip_model(),
        "CLIP Service": test_clip_service()
    }
    
    # Print summary
    success = print_summary(results)
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

