#!/usr/bin/env python3
"""
Pre-download CLIP-ViT-Large-Patch14 model
Run this once to download the model before starting the service
"""

import os
import sys
from transformers import CLIPProcessor, CLIPModel

MODEL_NAME = "openai/clip-vit-large-patch14"
CACHE_DIR = os.path.expanduser("~/.cache/huggingface/transformers")

print("=" * 60)
print("Downloading CLIP-ViT-Large-Patch14 Model")
print("=" * 60)
print(f"Model: {MODEL_NAME}")
print(f"Cache: {CACHE_DIR}")
print("Size: ~890MB (this may take several minutes)")
print("=" * 60 + "\n")

try:
    print("📥 Downloading processor...")
    processor = CLIPProcessor.from_pretrained(
        MODEL_NAME, 
        cache_dir=CACHE_DIR,
        use_fast=True
    )
    print("✅ Processor downloaded successfully!\n")

    print("📥 Downloading model...")
    model = CLIPModel.from_pretrained(
        MODEL_NAME, 
        cache_dir=CACHE_DIR
    )
    print("✅ Model downloaded successfully!\n")

    # Get model info
    param_count = sum(p.numel() for p in model.parameters())
    print(f"📊 Model Statistics:")
    print(f"   Parameters: ~{param_count / 1e6:.1f}M")
    print(f"   Embedding dimension: {model.config.projection_dim}")
    print(f"   Model size: ~{param_count * 4 / 1024 / 1024:.1f}MB (FP32)")

    print("\n" + "=" * 60)
    print("✅ Model download complete!")
    print(f"Location: {CACHE_DIR}")
    print("=" * 60)

except Exception as e:
    print(f"\n❌ Error downloading model: {str(e)}")
    print("   Ensure you have internet connection and sufficient disk space")
    sys.exit(1)

