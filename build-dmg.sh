#!/bin/bash

# Lightroom XMP Generator - DMG Build Script
# Builds DMG for Apple Silicon (arm64) only

set -e

echo "🚀 Building Lightroom XMP Generator DMG for Apple Silicon..."

# Check if electron-builder is installed
if ! command -v electron-builder &> /dev/null; then
    echo "❌ electron-builder not found. Installing..."
    npm install --save-dev electron-builder
fi

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist/

# Build the DMG
echo "📦 Building DMG..."
npm run build:dmg

# Check if build was successful
if [ -f "dist/Lightroom XMP Generator-1.0.0-arm64.dmg" ]; then
    echo "✅ DMG build successful!"
    echo "📁 Output: dist/Lightroom XMP Generator-1.0.0-arm64.dmg"
    
    # Show file size
    ls -lh "dist/Lightroom XMP Generator-1.0.0-arm64.dmg"
    
    echo ""
    echo "🎉 Build complete! You can now:"
    echo "   1. Double-click the DMG to mount it"
    echo "   2. Drag the app to Applications folder"
    echo "   3. Right-click → Open (first time only)"
    echo ""
else
    echo "❌ DMG build failed!"
    echo "Check the output above for errors."
    exit 1
fi
