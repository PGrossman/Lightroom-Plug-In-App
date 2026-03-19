// src/services/imageProcessor.js
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
    this.dcrawPath = PathHelper.getDcrawPath();
    
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

  async readOrientation(imagePath) {
    try {
      const { stdout } = await execFileAsync(this.exiftoolPath, [
        '-Orientation',
        '-n',
        imagePath
      ]);
      
      const match = stdout.match(/Orientation\s*:\s*(\d+)/);
      if (match) {
        const orientation = parseInt(match[1]);
        logger.debug('EXIF Orientation detected', { imagePath, orientation });
        return orientation;
      }
    } catch (error) {
      logger.warn('Could not read EXIF orientation', { imagePath, error: error.message });
    }
    
    return 1;
  }

  applyRotation(sharpInstance, orientation, imagePath) {
    switch (orientation) {
      case 3:
        sharpInstance.rotate(180);
        logger.debug('Rotating 180°', { imagePath, orientation });
        break;
      case 6:
        sharpInstance.rotate(90);
        logger.debug('Rotating 90° CW', { imagePath, orientation });
        break;
      case 8:
        sharpInstance.rotate(270);
        logger.debug('Rotating 270° CW', { imagePath, orientation });
        break;
      default:
        logger.debug('No rotation needed', { imagePath, orientation });
        break;
    }
    
    return sharpInstance;
  }

  isPsdFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ext === '.psd' || ext === '.psb';
  }

  async processWithSharp(imagePath) {
    await this.ensureTempDir();

    // ✅ Check if PSD file - Sharp doesn't support PSD, use exiftool instead
    if (this.isPsdFile(imagePath)) {
      logger.debug('PSD file detected, using exiftool for preview extraction', { imagePath });
      return await this.extractPsdPreview(imagePath);
    }

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
      
      const orientation = await this.readOrientation(imagePath);
      
      let sharpInstance = sharp(imagePath)
        .resize(1200, 1200, { 
          fit: 'inside',
          withoutEnlargement: true 
        });
      
      sharpInstance = this.applyRotation(sharpInstance, orientation, imagePath);
      
      await sharpInstance
        .jpeg({ quality: 85 })
        .toFile(outputPath);

      logger.debug('Sharp processing successful', { imagePath, outputPath, orientation });

      this.previewCache.set(imagePath, outputPath);

      return outputPath;

    } catch (error) {
      // ✅ Check if error is due to unsupported format
      if (error.message.includes('unsupported image format') || error.message.includes('Input file contains unsupported')) {
        logger.warn('Sharp does not support this file format, trying exiftool', { 
          imagePath,
          error: error.message 
        });
        // Try exiftool as fallback for other unsupported formats
        try {
          return await this.extractPsdPreview(imagePath);
        } catch (exiftoolError) {
          logger.error('Failed to extract preview with exiftool as fallback', { 
            imagePath,
            error: exiftoolError.message 
          });
          throw new Error(`Unsupported image format: ${path.extname(imagePath)}`);
        }
      }
      
      logger.error('Failed to process with Sharp', { 
        imagePath,
        error: error.message 
      });
      throw new Error(`Failed to process image with Sharp: ${error.message}`);
    }
  }

  async extractPsdPreview(psdPath) {
    await this.ensureTempDir();

    if (this.previewCache.has(psdPath)) {
      const cachedPath = this.previewCache.get(psdPath);
      try {
        await fs.access(cachedPath);
        logger.debug('Using cached PSD preview', { psdPath, cachedPath });
        return cachedPath;
      } catch {
        this.previewCache.delete(psdPath);
      }
    }

    const hash = crypto.createHash('md5').update(psdPath).digest('hex');
    const outputPath = path.join(this.tempDir, `${hash}.jpg`);
    const tempExtractPath = path.join(this.tempDir, `${hash}_temp.jpg`);

    try {
      logger.debug('Extracting PSD preview with exiftool', { psdPath });
      
      // Try to extract thumbnail/preview from PSD using exiftool
      const { stdout: previewData } = await execFileAsync(this.exiftoolPath, [
        '-b',
        '-ThumbnailImage',
        psdPath
      ], {
        encoding: 'buffer',
        maxBuffer: 50 * 1024 * 1024
      });

      if (!previewData || previewData.length === 0) {
        // Try PreviewImage as fallback
        try {
          const { stdout: previewData2 } = await execFileAsync(this.exiftoolPath, [
            '-b',
            '-PreviewImage',
            psdPath
          ], {
            encoding: 'buffer',
            maxBuffer: 50 * 1024 * 1024
          });
          
          if (!previewData2 || previewData2.length === 0) {
            throw new Error('No preview image found in PSD file');
          }
          
          await fs.writeFile(tempExtractPath, previewData2);
        } catch {
          throw new Error('No preview image found in PSD file');
        }
      } else {
        await fs.writeFile(tempExtractPath, previewData);
      }

      logger.debug('PSD preview extracted to temp file', { tempExtractPath });

      const orientation = await this.readOrientation(psdPath);

      let sharpInstance = sharp(tempExtractPath)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true });
      
      sharpInstance = this.applyRotation(sharpInstance, orientation, psdPath);
      
      await sharpInstance
        .jpeg({ quality: 85 })
        .toFile(outputPath);

      try {
        await fs.unlink(tempExtractPath);
      } catch (e) {
        logger.warn('Could not delete temp PSD file', { tempExtractPath });
      }

      logger.debug('PSD preview processed successfully', { psdPath, outputPath, orientation });

      this.previewCache.set(psdPath, outputPath);

      return outputPath;

    } catch (error) {
      try {
        await fs.unlink(tempExtractPath);
      } catch (e) {
        // Ignore
      }

      logger.error('Failed to extract PSD preview', { 
        psdPath,
        error: error.message 
      });
      throw new Error(`Failed to extract PSD preview: ${error.message}`);
    }
  }

  async extractPreview(rawPath) {
    await this.ensureTempDir();

    if (!this.isRawFile(rawPath)) {
      logger.debug('Not a RAW file, using Sharp instead', { rawPath });
      return await this.processWithSharp(rawPath);
    }

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

      const orientation = await this.readOrientation(rawPath);

      let sharpInstance = sharp(tempExtractPath)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true });
      
      sharpInstance = this.applyRotation(sharpInstance, orientation, rawPath);
      
      await sharpInstance
        .jpeg({ quality: 85 })
        .toFile(outputPath);

      try {
        await fs.unlink(tempExtractPath);
      } catch (e) {
        logger.warn('Could not delete temp file', { tempExtractPath });
      }

      logger.debug('Preview processed successfully', { rawPath, outputPath, orientation });

      this.previewCache.set(rawPath, outputPath);

      return outputPath;

    } catch (error) {
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

  async convertWithDcraw(rawPath, outputPath) {
    try {
      const fs = require('fs');
      try {
        if (!fs.existsSync(this.dcrawPath)) {
          await execFileAsync('which', ['dcraw']);
        }
      } catch (whichError) {
        logger.warn('dcraw not found, skipping dcraw conversion');
        throw new Error('dcraw not installed');
      }

      const dcrawToUse = fs.existsSync(this.dcrawPath) ?
        this.dcrawPath : 'dcraw';
      
      const { stdout } = await execFileAsync(dcrawToUse, [
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

      const orientation = await this.readOrientation(rawPath);
      
      let sharpInstance = sharp(Buffer.from(stdout))
        .resize(1200, 1200, { 
          fit: 'inside',
          withoutEnlargement: true 
        });
      
      sharpInstance = this.applyRotation(sharpInstance, orientation, rawPath);
      
      await sharpInstance
        .jpeg({ quality: 85 })
        .toFile(outputPath);

      logger.debug('dcraw conversion successful', { rawPath, outputPath, orientation });

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
        hashLength: hash.length,
        isPreviewFile: imagePath.includes('/temp/')
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

  async batchProcessImages(imagePaths, onProgress) {
    const results = [];
    const total = imagePaths.length;

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i];
      
      if (onProgress) {
        onProgress({
          current: i + 1,
          total,
          percent: Math.round(((i + 1) / total) * 100),
          currentImage: path.basename(imagePath)
        });
      }

      const result = await this.processImage(imagePath);
      results.push({
        path: imagePath,
        ...result
      });
    }

    return results;
  }

  clearCache() {
    this.previewCache.clear();
    logger.info('Preview cache cleared');
  }

  getCacheStats() {
    return {
      size: this.previewCache.size,
      entries: Array.from(this.previewCache.keys())
    };
  }
}

module.exports = ImageProcessor;
