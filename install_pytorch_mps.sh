#!/bin/bash
# ============================================================================
# APPLE SILICON GPU OPTIMIZATION SCRIPT
# ============================================================================
# Installs PyTorch with MPS (Metal Performance Shaders) support
# for Apple Silicon M1/M2/M3 chips
# ============================================================================

set -e  # Exit on error

echo "🍎 ============================================================"
echo "🍎 Installing PyTorch for Apple Silicon (MPS GPU support)"
echo "🍎 ============================================================"
echo ""

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "❌ ERROR: This script is only for macOS"
    exit 1
fi

# Check macOS version (MPS requires 12.3+)
macos_version=$(sw_vers -productVersion)
echo "📱 macOS Version: $macos_version"

# Check if running on Apple Silicon
arch=$(uname -m)
if [[ "$arch" != "arm64" ]]; then
    echo "⚠️  WARNING: Not running on Apple Silicon (detected: $arch)"
    echo "   MPS acceleration requires M1/M2/M3 chip"
fi

echo ""
echo "🔧 Setting up Python environment..."

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "   Creating virtual environment..."
    python3 -m venv venv
    echo "   ✅ Virtual environment created"
else
    echo "   ✅ Virtual environment already exists"
fi

# Activate virtual environment
echo "   Activating virtual environment..."
source venv/bin/activate

# Upgrade pip
echo ""
echo "📦 Upgrading pip..."
pip3 install --upgrade pip setuptools wheel

# Install PyTorch with MPS support
echo ""
echo "🔥 Installing PyTorch with Apple Silicon GPU support..."
echo "   This may take a few minutes..."
pip3 install torch torchvision torchaudio

# Install other requirements
echo ""
echo "📚 Installing additional dependencies..."
pip3 install -r requirements.txt

# Verify installation
echo ""
echo "✅ Installation complete! Verifying GPU support..."
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

python3 << 'EOF'
import torch
import sys

print("\n🔍 PyTorch Installation Summary:")
print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
print(f"   PyTorch Version: {torch.__version__}")
print(f"   Python Version: {sys.version.split()[0]}")
print(f"   MPS Available: {'✅ YES' if torch.backends.mps.is_available() else '❌ NO'}")
print(f"   MPS Built: {'✅ YES' if torch.backends.mps.is_built() else '❌ NO'}")
print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

if torch.backends.mps.is_available():
    print("\n🚀 SUCCESS! Apple Silicon GPU acceleration is ENABLED!")
    print("   Your CLIP model will run on the GPU (Metal Performance Shaders)")
    print("   Expected speedup: 3-6x faster than CPU-only")
    
    # Test GPU computation
    print("\n🧪 Testing GPU computation...")
    try:
        device = torch.device("mps")
        x = torch.randn(1000, 1000, device=device)
        y = torch.randn(1000, 1000, device=device)
        z = torch.matmul(x, y)
        print(f"   ✅ GPU test passed! Tensor device: {z.device}")
    except Exception as e:
        print(f"   ⚠️  GPU test warning: {e}")
else:
    print("\n⚠️  WARNING: MPS (GPU) not available")
    print("\n📋 Requirements for Apple Silicon GPU:")
    print("   • macOS 12.3 or later")
    print("   • M1, M2, or M3 chip")
    print("   • PyTorch 1.12 or later")
    print("\n   The app will still work but will use CPU (slower)")
    sys.exit(1)
EOF

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ INSTALLATION COMPLETE!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📝 Next Steps:"
echo "   1. Run: python3 verify_mps.py (comprehensive GPU test)"
echo "   2. Run: npm start (start the application)"
echo ""
echo "🔍 To check GPU status anytime:"
echo "   python3 -c 'import torch; print(f\"MPS: {torch.backends.mps.is_available()}\")'"
echo ""

