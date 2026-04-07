// src/services/imageProcessor.js
//✅ SUPER CLUSTER FIX: Unified rotation logic for all file types

const sharp = require('sharp');
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const logger = require('../utils/logger');
const PathHelper = require('../utils/pathHelper');

const execFileAsync = promisify(execFile);

class ImageProcessor {
  constructor() {
    this.tempDir = PathHelper.getTempDir();
    this.previewCache = new Map();
    this.exiftoolPath = PathHelper.getExiftoolPath();
    
    this.rawExtensions = ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.orf', '.rw2', '.pef', '.erf'];
    this.processedExtensions = ['.tif', '.tiff', '.jpg', '.jpeg', '.png', '.psd', '.psb'];
  }

  async ensureTempDir() {
    try {
      await fs.mkdir(this.tempDir, { recursive: true });
    } catch (error) {
      logger.error('Failed to create temp directory', { error: error.message });
      throw error;
    }
  }

  isRawFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.rawExtensions.includes(ext);
  }

  /**
   * ✅ NEW: Read EXIF Orientation from any image file
   * Returns orientation number (1-8), defaulting to 1 if not found
   */
  async readOrientation(imagePath) {
    let orientation = 1; // Default: no rotation needed
    
    try {
      const { stdout } = await execFileAsync(this.exiftoolPath, [
        '-Orientation',
        '-n', // Numeric output
        imagePath
      ]);
      
      const match = stdout.match(/Orientation\s*:\s*(\d+)/);
      if (match) {
        orientation = parseInt(match[1]);
        logger.debug('EXIF Orientation detected', { 
          file: path.basename(imagePath),
          orientation 
        });
      }
    } catch (error) {
      logger.warn('Could not read EXIF orientation', { 
        file: path.basename(imagePath),
        error: error.message 
      });
    }
    
    return orientation;
  }

  /**
   * ✅ NEW: Apply rotation to Sharp instance based on EXIF Orientation
   * Uses SAME logic for all file types to ensure consistency
   */
  applyRotation(sharpInstance, orientation, imagePath) {
    switch (orientation) {
      case 3:
        sharpInstance.rotate(180);
        logger.debug('Rotating 180°', { file: path.basename(imagePath) });
        break;
      case 6:
        sharpInstance.rotate(90);
        logger.debug('Rotating 90° CW', { file: path.basename(imagePath) });
        break;
      case 8:
        sharpInstance.rotate(270);
        logger.debug('Rotating 270° CW', { file: path.basename(imagePath) });
        break;
      default:
        logger.debug('No rotation needed', { 
          file: path.basename(imagePath),
          orientation 
        });
        break;
    }
    
    return sharpInstance;
  }

  /**
   * ✅ FIXED: Process TIF/processed images with Sharp
   * NOW USES SAME ROTATION LOGIC AS RAW FILES
   */
  async processWithSharp(imagePath) {
    await this.ensureTempDir();

    // Check cache first
    if (this.previewCache.has(imagePath)) {
      const cachedPath = this.previewCache.get(imagePath);
      try {
        await fs.access(cachedPath);
        logger.debug('Using cached preview (Sharp)', { imagePath, cachedPath });
        return cachedPath;
      } catch {
        this.previewCache.delete(imagePath);
      }
    }

    const hash = crypto.createHash('md5').update(imagePath).digest('hex');
    const outputPath = path.join(this.tempDir, `${hash}.jpg`);

    try {
      logger.debug('Processing with Sharp', { imagePath });
      
      // ✅ CRITICAL FIX: Read orientation FIRST, then apply conditionally
      const orientation = await this.readOrientation(imagePath);
      
      // Create Sharp instance with resize
      const sharpInstance = sharp(imagePath)
        .resize(1200, 1200, { 
          fit: 'inside',
          withoutEnlargement: true 
        });
      
      // ✅ CRITICAL FIX: Use unified rotation logic
      this.applyRotation(sharpInstance, orientation, imagePath);
      
      // Save as JPEG
      await sharpInstance
        .jpeg({ quality: 85 })
        .toFile(outputPath);

      logger.debug('Sharp processing successful', { imagePath, outputPath });

      // Cache the result
      this.previewCache.set(imagePath, outputPath);

      return outputPath;

    } catch (error) {
      logger.error('Failed to process with Sharp', { 
        imagePath,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to process image with Sharp: ${error.message}`);
    }
  }

  /**
   * Extract embedded preview from RAW file using exiftool
   * Then rotate with Sharp based on EXIF orientation
   */
  async extractPreview(rawPath) {
    await this.ensureTempDir();

    // ✅ Route non-RAW files to Sharp processing
    if (!this.isRawFile(rawPath)) {
      logger.debug('Not a RAW file, using Sharp instead', { rawPath });
      return await this.processWithSharp(rawPath);
    }

    // Check cache first
    if (this.previewCache.has(rawPath)) {
      const cachedPath = this.previewCache.get(rawPath);
      try {
        await fs.access(cachedPath);
        logger.debug('Using cached preview', { rawPath, cachedPath });
        return cachedPath;
      } catch {
        this.previewCache.delete(rawPath);
      }
    }

    const hash = crypto.createHash('md5').update(rawPath).digest('hex');
    const outputPath = path.join(this.tempDir, `${hash}.jpg`);
    const tempExtractPath = path.join(this.tempDir, `${hash}_temp.jpg`);

    try {
      // Step 1: Extract preview JPG using exiftool
      logger.debug('Extracting preview with exiftool', { rawPath });
      
      const { stdout: previewData } = await execFileAsync(this.exiftoolPath, [
        '-b',
        '-PreviewImage',
        rawPath
      ], {
        encoding: 'buffer',
        maxBuffer: 50 * 1024 * 1024
      });

      if (!previewData || previewData.length === 0) {
        throw new Error('No preview image found in RAW file');
      }

      await fs.writeFile(tempExtractPath, previewData);
      logger.debug('Preview extracted to temp file', { tempExtractPath });

      // Step 2: Read EXIF Orientation (✅ SAME METHOD AS TIF FILES)
      const orientation = await this.readOrientation(rawPath);

      // Step 3: Process with Sharp (resize + rotate)
      const sharpInstance = sharp(tempExtractPath)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true });
      
      // ✅ Use unified rotation logic
      this.applyRotation(sharpInstance, orientation, rawPath);
      
      await sharpInstance
        .jpeg({ quality: 85 })
        .toFile(outputPath);

      // Cleanup
      try {
        await fs.unlink(tempExtractPath);
      } catch (e) {
        logger.warn('Could not delete temp file', { tempExtractPath });
      }

      logger.debug('Preview processed successfully', { rawPath, outputPath, orientation });

      this.previewCache.set(rawPath, outputPath);

      return outputPath;

    } catch (error) {
      // Cleanup on error
      try {
        await fs.unlink(tempExtractPath);
      } catch (e) {
        // Ignore
      }

      logger.error('Failed to extract and rotate preview', { 
        rawPath,
        error: error.message 
      });
      throw new Error(`Failed to extract preview: ${error.message}`);
    }
  }

  /**
   * Convert RAW file to JPEG using dcraw (fallback method)
   */
  async convertWithDcraw(rawPath, outputPath) {
    try {
      try {
        await execFileAsync('which', ['dcraw']);
      } catch (whichError) {
        logger.warn('dcraw not found in PATH');
        throw new Error('dcraw not installed');
      }

      const { stdout } = await execFileAsync('dcraw', [
        '-c',
        '-w',
        '-q', '3',
        '-h',
        rawPath
      ], {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 30000
      });

      if (!stdout || stdout.length === 0) {
        throw new Error('dcraw produced no output');
      }

      // ✅ Use unified rotation logic for dcraw too
      const orientation = await this.readOrientation(rawPath);
      
      const sharpInstance = sharp(Buffer.from(stdout))
        .resize(1200, 1200, { 
          fit: 'inside',
          withoutEnlargement: true 
        });
      
      this.applyRotation(sharpInstance, orientation, rawPath);
      
      await sharpInstance
        .jpeg({ quality: 85 })
        .toFile(outputPath);

      logger.debug('dcraw conversion successful', { rawPath, outputPath });

    } catch (error) {
      logger.error('dcraw conversion failed', { rawPath, error: error.message });
      throw new Error(`dcraw conversion failed: ${error.message}`);
    }
  }

  async generateHash(imagePath) {
    try {
      const imghash = require('imghash');
      const hash = await imghash.hash(imagePath, 16);
      
      logger.debug('Hash generated', { 
        originalPath: imagePath,
        hash: hash.substring(0, 16) + '...',
        hashLength: hash.length
      });
      return hash;

    } catch (error) {
      logger.error('Failed to generate hash', { 
        imagePath, 
        error: error.message 
      });
      throw error;
    }
  }

  calculateHammingDistance(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) {
      return Infinity;
    }

    let distance = 0;
    for (let i = 0; i < hash1.length; i++) {
      if (hash1[i] !== hash2[i]) {
        distance++;
      }
    }

    return distance;
  }

  areSimilar(hash1, hash2, threshold = 13) {
    const distance = this.calculateHammingDistance(hash1, hash2);
    return distance < threshold;
  }

  async processImage(imagePath, timeout = 30000) {
    try {
      logger.info('Processing image', { imagePath });

      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Processing timeout')), timeout)
      );

      const processingPromise = (async () => {
        const previewPath = await this.extractPreview(imagePath);
        const hash = await this.generateHash(previewPath);
        return { previewPath, hash };
      })();

      const { previewPath, hash } = await Promise.race([
        processingPromise,
        timeoutPromise
      ]);

      return {
        success: true,
        previewPath,
        hash
      };

    } catch (error) {
      logger.error('Image processing failed', { 
        imagePath, 
        error: error.message,
        stack: error.stack 
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async processBatch(imagePaths, progressCallback = null) {
    const results = [];
    const total = imagePaths.length;

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];
      
      const result = await this.processImage(imagePath);
      results.push({
        path: imagePath,
        ...result
      });

      if (progressCallback) {
        progressCallback({
          current: i + 1,
          total,
          percent: Math.round(((i + 1) / total) * 100),
          currentFile: path.basename(imagePath)
        });
      }

      logger.debug('Batch progress', { 
        completed: i + 1, 
        total, 
        file: path.basename(imagePath) 
      });
    }

    logger.info('Batch processing complete', { 
      total, 
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    });

    return results;
  }

  async cleanup(keepCache = false) {
    try {
      if (!keepCache) {
        await fs.rm(this.tempDir, { recursive: true, force: true });
        this.previewCache.clear();
        logger.info('Temp directory cleaned up');
      } else {
        logger.info('Keeping preview cache');
      }
    } catch (error) {
      logger.error('Cleanup failed', { error: error.message });
    }
  }

  getCacheStats() {
    return {
      cachedPreviews: this.previewCache.size,
      tempDir: this.tempDir
    };
  }
}

module.exports = ImageProcessor;
