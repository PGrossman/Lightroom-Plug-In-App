#!/usr/bin/env python3
"""
CLIP Similarity Service - Using ViT-Large-Patch14 Model
Provides image similarity detection using OpenAI's largest publicly available CLIP model
with explicit GPU acceleration support (Apple MPS / NVIDIA CUDA)
"""

import os
import sys
import json
import logging
from pathlib import Path
from typing import List, Dict, Any

import torch
import torch.nn.functional as F
from PIL import Image
from transformers import CLIPProcessor, CLIPModel
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

# ============================================
# Logging Configuration
# ============================================
# Configure logging to send INFO/WARNING to stdout, ERROR/CRITICAL to stderr
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),  # INFO, WARNING go to stdout
    ]
)
# Only ERROR and CRITICAL go to stderr
error_handler = logging.StreamHandler(sys.stderr)
error_handler.setLevel(logging.ERROR)
logger = logging.getLogger("CLIP-Service")
logger.addHandler(error_handler)

# ============================================
# Device Configuration (Explicit GPU Setup)
# ============================================
def get_device() -> tuple[torch.device, str]:
    """
    Explicitly select the best available device for CLIP inference
    Priority: Apple MPS > NVIDIA CUDA > CPU
    
    Returns:
        tuple: (torch.device, device_name_string)
    """
    device_name = "CPU"
    
    # Option 1: Apple Silicon MPS (Metal Performance Shaders)
    if torch.backends.mps.is_available() and torch.backends.mps.is_built():
        device = torch.device("mps")
        device_name = "Apple Silicon MPS"
        logger.info("✅ GPU ENABLED: Apple Silicon MPS detected")
        logger.info(f"   PyTorch version: {torch.__version__}")
        logger.info("   CLIP will use GPU acceleration (3-6x faster)")
        
    # Option 2: NVIDIA CUDA
    elif torch.cuda.is_available():
        device = torch.device("cuda:0")
        device_name = f"NVIDIA CUDA ({torch.cuda.get_device_name(0)})"
        logger.info("✅ GPU ENABLED: NVIDIA CUDA detected")
        logger.info(f"   GPU: {torch.cuda.get_device_name(0)}")
        logger.info(f"   PyTorch version: {torch.__version__}")
        logger.info("   CLIP will use GPU acceleration")
        
    # Option 3: CPU Fallback
    else:
        device = torch.device("cpu")
        device_name = "CPU (No GPU detected)"
        logger.warning("⚠️  No GPU acceleration available - using CPU")
        logger.warning("   Performance will be significantly slower")
        logger.warning("   For Apple Silicon: Run ./install_pytorch_mps.sh")
        logger.warning("   For NVIDIA: Install CUDA-enabled PyTorch")
    
    return device, device_name

# Initialize device
DEVICE, DEVICE_NAME = get_device()

# ============================================
# Model Configuration
# ============================================
MODEL_NAME = "openai/clip-vit-large-patch14"  # Largest publicly available CLIP model
# Check both cache locations (older transformers cache and newer hub cache)
TRANSFORMERS_CACHE = os.path.expanduser("~/.cache/huggingface/transformers")
HUB_CACHE = os.path.expanduser("~/.cache/huggingface/hub")
MODEL_CACHE_DIR = TRANSFORMERS_CACHE  # Use transformers cache (works for both old and new)

logger.info("=" * 60)
logger.info("CLIP SIMILARITY SERVICE - CONFIGURATION")
logger.info("=" * 60)
logger.info(f"Model: {MODEL_NAME}")
logger.info(f"Device: {DEVICE_NAME}")
logger.info(f"Cache Directory: {MODEL_CACHE_DIR}")
logger.info("=" * 60)

# ============================================
# Load Model and Processor
# ============================================
try:
    # Check if cache directory exists and has model files
    # Check both transformers cache and hub cache
    transformers_cache_path = os.path.join(TRANSFORMERS_CACHE, "models--openai--clip-vit-large-patch14")
    hub_cache_path = os.path.join(HUB_CACHE, "models--openai--clip-vit-large-patch14")
    
    cache_exists_transformers = os.path.exists(transformers_cache_path)
    cache_exists_hub = os.path.exists(hub_cache_path)
    cache_exists = cache_exists_transformers or cache_exists_hub
    
    logger.info(f"Checking for cached model...")
    logger.info(f"  Transformers cache: {TRANSFORMERS_CACHE}")
    logger.info(f"  Transformers cache exists: {cache_exists_transformers}")
    logger.info(f"  Hub cache: {HUB_CACHE}")
    logger.info(f"  Hub cache exists: {cache_exists_hub}")
    
    if cache_exists:
        cache_location = transformers_cache_path if cache_exists_transformers else hub_cache_path
        logger.info(f"✅ Found cached model in: {cache_location}")
        logger.info("   Using cached model (no download needed)")
    else:
        logger.info(f"⚠️  Cached model not found in either location")
        logger.info("   Will download model on first use")
    
    # Determine if we should use cached model only
    use_cached_only = cache_exists
    
    logger.info("Loading CLIP model and processor...")
    if use_cached_only:
        logger.info("✅ Using cached model (should be fast, no download)")
    else:
        logger.info("⏳ First load may take 5-10 minutes (downloading ~890MB model)")
    
    # Load processor (handles image preprocessing)
    # Try with local_files_only first if cache exists, fallback to download if needed
    try:
        processor = CLIPProcessor.from_pretrained(
            MODEL_NAME,
            cache_dir=MODEL_CACHE_DIR,
            use_fast=True,  # Use fast processor if available
            local_files_only=use_cached_only  # Use cache only if model is cached
        )
    except Exception as e:
        if use_cached_only:
            # Cache exists but failed to load, try downloading
            logger.warn(f"Failed to load from cache: {e}")
            logger.info("Attempting to download model...")
            processor = CLIPProcessor.from_pretrained(
                MODEL_NAME,
                cache_dir=MODEL_CACHE_DIR,
                use_fast=True,
                local_files_only=False
            )
        else:
            raise
    
    # Load model
    try:
        model = CLIPModel.from_pretrained(
            MODEL_NAME,
            cache_dir=MODEL_CACHE_DIR,
            local_files_only=use_cached_only  # Use cache only if model is cached
        )
    except Exception as e:
        if use_cached_only:
            # Cache exists but failed to load, try downloading
            logger.warn(f"Failed to load model from cache: {e}")
            logger.info("Attempting to download model...")
            model = CLIPModel.from_pretrained(
                MODEL_NAME,
                cache_dir=MODEL_CACHE_DIR,
                local_files_only=False
            )
        else:
            raise
    
    # 🔥 EXPLICITLY MOVE MODEL TO GPU
    logger.info(f"🔥 Moving model to {DEVICE_NAME}...")
    model = model.to(DEVICE)
    
    # Set to evaluation mode (disables dropout, etc.)
    model.eval()
    
    logger.info("✅ Model loaded successfully and moved to GPU")
    logger.info(f"   Model parameters: ~{sum(p.numel() for p in model.parameters()) / 1e6:.1f}M")
    logger.info(f"   Embedding dimension: {model.config.projection_dim}")
    
except Exception as e:
    logger.error(f"❌ Failed to load CLIP model: {str(e)}")
    logger.error("   Ensure you have installed: pip install transformers torch pillow")
    sys.exit(1)

# ============================================
# FastAPI Application
# ============================================
app = FastAPI(
    title="CLIP Similarity Service",
    description="Image similarity detection using CLIP-ViT-Large-Patch14",
    version="2.0.0"
)

# ============================================
# Request/Response Models
# ============================================
class EmbeddingRequest(BaseModel):
    paths: List[str]

class SimilarityRequest(BaseModel):
    emb1: List[float]
    emb2: List[float]

# ============================================
# API Endpoints
# ============================================

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "model": MODEL_NAME,
        "device": DEVICE_NAME,
        "pytorch_version": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "mps_available": torch.backends.mps.is_available() if hasattr(torch.backends, 'mps') else False
    }

@app.post("/embeddings")
async def generate_embeddings(request: EmbeddingRequest):
    """
    Generate CLIP embeddings for a batch of images
    
    Args:
        request: EmbeddingRequest containing list of image paths
        
    Returns:
        dict: {"embeddings": List[List[float]], "failed": List[Dict] | None}
    """
    try:
        image_paths = request.paths
        logger.info(f"📊 Generating embeddings for {len(image_paths)} images")
        
        embeddings = []
        failed_images = []
        
        for idx, path in enumerate(image_paths):
            try:
                # Load and preprocess image
                image = Image.open(path).convert("RGB")
                
                # Process image (resize, normalize)
                inputs = processor(
                    images=image,
                    return_tensors="pt",
                    padding=True
                )
                
                # 🔥 EXPLICITLY MOVE INPUT TO GPU
                inputs = {k: v.to(DEVICE) for k, v in inputs.items()}
                
                # Generate embedding (no gradient computation needed)
                with torch.no_grad():
                    image_features = model.get_image_features(**inputs)
                    
                    # Normalize to unit vector (for cosine similarity)
                    image_features = F.normalize(image_features, p=2, dim=-1)
                    
                    # Convert to list and move back to CPU for JSON serialization
                    embedding = image_features.cpu().squeeze().tolist()
                    embeddings.append(embedding)
                
                if (idx + 1) % 5 == 0:
                    logger.info(f"   Processed {idx + 1}/{len(image_paths)} images")
                    
            except Exception as e:
                logger.error(f"❌ Failed to process {path}: {str(e)}")
                failed_images.append({"path": path, "error": str(e)})
                embeddings.append(None)  # Placeholder for failed image
        
        logger.info(f"✅ Embedding generation complete: {len(embeddings) - len(failed_images)}/{len(image_paths)} successful")
        
        if failed_images:
            logger.warning(f"⚠️  {len(failed_images)} images failed to process")
        
        return {
            "embeddings": embeddings,
            "failed": failed_images if failed_images else None
        }
        
    except Exception as e:
        logger.error(f"❌ Embedding generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/similarity")
async def calculate_similarity(request: SimilarityRequest):
    """
    Calculate cosine similarity between two embeddings
    
    Args:
        request: SimilarityRequest containing two embeddings
        
    Returns:
        dict: {"similarity": float}  # Range: 0.0 to 1.0
    """
    try:
        # Convert to tensors
        emb1 = torch.tensor(request.emb1)
        emb2 = torch.tensor(request.emb2)
        
        # Calculate cosine similarity
        # (embeddings are already normalized, so dot product = cosine similarity)
        similarity = torch.dot(emb1, emb2).item()
        
        # Ensure similarity is in range [0, 1]
        similarity = max(0.0, min(1.0, similarity))
        
        return {"similarity": similarity}
        
    except Exception as e:
        logger.error(f"❌ Similarity calculation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# ============================================
# Startup
# ============================================
if __name__ == "__main__":
    logger.info("\n" + "=" * 60)
    logger.info("🚀 Starting CLIP Similarity Service")
    logger.info("=" * 60)
    logger.info(f"   Model: {MODEL_NAME}")
    logger.info(f"   Device: {DEVICE_NAME}")
    logger.info(f"   Endpoint: http://127.0.0.1:8765")
    logger.info("=" * 60 + "\n")
    
    # Configure uvicorn to only send warnings/errors to stderr, info to stdout
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8765,
        log_level="info",
        log_config=None  # Use our custom logging config
    )
