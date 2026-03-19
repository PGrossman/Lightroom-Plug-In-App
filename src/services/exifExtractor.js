// src/services/exifExtractor.js
const { execFile } = require('child_process');
const { promisify } = require('util');
const logger = require('../utils/logger');
const PathHelper = require('../utils/pathHelper');

const execFileAsync = promisify(execFile);

class ExifExtractor {
  constructor() {
    this.cache = new Map(); // Cache EXIF data to avoid re-reading files
    this.exiftoolPath = PathHelper.getExiftoolPath();
  }

  /**
   * Extract all metadata at once (most efficient - single exiftool call)
   * Returns: { timestamp, gps, camera }
   */
  async extractMetadata(imagePath) {
    // ✅ FIX: Handle both file objects and path strings
    const actualPath = typeof imagePath === 'string' ? imagePath : imagePath?.path;
    
    if (!actualPath) {
      logger.error('extractMetadata: No path provided', { received: imagePath });
      return {
        timestamp: null,
        gps: null,
        camera: { make: null, model: null }
      };
    }
    
    // Check cache first
    if (this.cache.has(actualPath)) {
      return this.cache.get(actualPath);
    }

    try {
      const { stdout } = await execFileAsync(this.exiftoolPath, [
        '-DateTimeOriginal',
        '-CreateDate',
        '-SubSecTimeOriginal',
        '-GPSLatitude',
        '-GPSLongitude',
        '-GPSLatitudeRef',
        '-GPSLongitudeRef',
        '-Make',
        '-Model',
        '-json',
        actualPath
      ]);

      const data = JSON.parse(stdout)[0];
      
      const metadata = {
        timestamp: this.parseTimestamp(data),
        gps: this.parseGPS(data),
        camera: {
          make: data.Make || null,
          model: data.Model || null
        }
      };

      // Cache the result
      this.cache.set(actualPath, metadata);
      
      logger.debug('Metadata extracted', { 
        imagePath: actualPath,
        hasTimestamp: !!metadata.timestamp,
        hasGPS: !!metadata.gps
      });
      
      return metadata;
      
    } catch (error) {
      logger.error('Failed to extract metadata', { 
        imagePath: actualPath,
        error: error.message 
      });
      return {
        timestamp: null,
        gps: null,
        camera: { make: null, model: null }
      };
    }
  }

  /**
   * Extract only timestamp from RAW file (legacy method - kept for compatibility)
   * Returns timestamp in milliseconds, or null if not found
   */
  async extractFromRAW(imagePath) {
    // ✅ FIX: Handle both file objects and path strings
    const actualPath = typeof imagePath === 'string' ? imagePath : imagePath?.path;
    
    if (!actualPath) {
      logger.error('extractFromRAW: No path provided', { received: imagePath });
      return null;
    }
    
    // Check cache first - if we have full metadata, extract timestamp
    if (this.cache.has(actualPath)) {
      const cached = this.cache.get(actualPath);
      return cached.timestamp;
    }

    try {
      const { stdout } = await execFileAsync(this.exiftoolPath, [
        '-DateTimeOriginal',
        '-s3',
        '-d', '%Y:%m:%d %H:%M:%S',
        actualPath
      ]);

      const dateTimeStr = stdout.trim();
      
      if (!dateTimeStr || dateTimeStr === '-') {
        logger.warn('No timestamp found in EXIF', { imagePath: actualPath });
        return null;
      }

      const parts = dateTimeStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      
      if (!parts) {
        logger.warn('Could not parse timestamp', { imagePath: actualPath, dateTimeStr });
        return null;
      }

      const [, year, month, day, hour, minute, second] = parts;
      
      const date = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      );

      const timestampMs = date.getTime();
      
      logger.debug('Timestamp extracted', { 
        imagePath: actualPath,
        timestamp: date.toISOString(),
        timestampMs
      });
      
      return timestampMs;
      
    } catch (error) {
      logger.error('Failed to extract timestamp', { 
        imagePath: actualPath,
        error: error.message 
      });
      return null;
    }
  }

  /**
   * Parse timestamp from exiftool JSON output
   */
  parseTimestamp(exifData) {
    const dateTimeStr = exifData.DateTimeOriginal || exifData.CreateDate;
    
    if (!dateTimeStr) {
      return null;
    }

    try {
      // Format: "2012:11:03 10:07:15"
      const parts = dateTimeStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      
      if (!parts) {
        return null;
      }

      const [, year, month, day, hour, minute, second] = parts;
      
      const date = new Date(
        parseInt(year),
        parseInt(month) - 1,
        parseInt(day),
        parseInt(hour),
        parseInt(minute),
        parseInt(second)
      );

      return date.getTime();
    } catch (error) {
      logger.error('Failed to parse timestamp', { error: error.message });
      return null;
    }
  }

  /**
   * Parse GPS coordinates from exiftool JSON output
   * Returns: { latitude: decimal, longitude: decimal } or null
   */
  parseGPS(exifData) {
    if (!exifData.GPSLatitude || !exifData.GPSLongitude) {
      return null;
    }

    try {
      const latitude = this.convertToDecimal(
        exifData.GPSLatitude,
        exifData.GPSLatitudeRef
      );
      
      const longitude = this.convertToDecimal(
        exifData.GPSLongitude,
        exifData.GPSLongitudeRef
      );

      if (latitude === null || longitude === null) {
        return null;
      }

      return { latitude, longitude };
    } catch (error) {
      logger.error('Failed to parse GPS', { error: error.message });
      return null;
    }
  }

  /**
   * Convert GPS coordinate from EXIF format to decimal degrees
   * Handles formats like: "51 deg 23' 19.32\" N" or "51.3887"
   */
  convertToDecimal(coordinate, ref) {
    if (typeof coordinate === 'number') {
      // Already in decimal format
      const decimal = coordinate;
      return (ref === 'S' || ref === 'W') ? -decimal : decimal;
    }

    if (typeof coordinate === 'string') {
      // Try to parse decimal format first
      const decimalMatch = coordinate.match(/^([\d.]+)$/);
      if (decimalMatch) {
        const decimal = parseFloat(decimalMatch[1]);
        return (ref === 'S' || ref === 'W') ? -decimal : decimal;
      }

      // Parse DMS format: "51 deg 23' 19.32\" N"
      const dmsMatch = coordinate.match(/(\d+)\s*deg\s*(\d+)'\s*([\d.]+)"/);
      if (dmsMatch) {
        const [, degrees, minutes, seconds] = dmsMatch;
        const decimal = parseFloat(degrees) + 
                       parseFloat(minutes) / 60 + 
                       parseFloat(seconds) / 3600;
        return (ref === 'S' || ref === 'W') ? -decimal : decimal;
      }
    }

    return null;
  }

  /**
   * Batch extract metadata from multiple files (optimized for performance)
   */
  async extractBatchMetadata(imagePaths) {
    try {
      // ✅ FIX: Convert all items to paths (handle both objects and strings)
      const actualPaths = imagePaths.map(item => 
        typeof item === 'string' ? item : item.path
      );
      
      // Process in smaller batches to avoid buffer issues
      const batchSize = 20; // Process 20 images at a time
      const allResults = [];

      for (let i = 0; i < actualPaths.length; i += batchSize) {
        const batch = actualPaths.slice(i, i + batchSize);
        
        const { stdout } = await execFileAsync(this.exiftoolPath, [
          '-DateTimeOriginal',
          '-CreateDate',
          '-GPSLatitude',
          '-GPSLongitude',
          '-GPSLatitudeRef',
          '-GPSLongitudeRef',
          '-Make',
          '-Model',
          '-json',
          ...batch  // ✅ Now uses actualPaths which are guaranteed to be strings
        ], {
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer per batch
          timeout: 60000 // 60 second timeout per batch
        });

        const dataArray = JSON.parse(stdout);
        
        const batchResults = dataArray.map((data, index) => ({
          path: batch[index],
          timestamp: this.parseTimestamp(data),
          gps: this.parseGPS(data),
          camera: {
            make: data.Make || null,
            model: data.Model || null
          }
        }));

        allResults.push(...batchResults);

        // Cache all results
        batchResults.forEach(result => {
          this.cache.set(result.path, {
            timestamp: result.timestamp,
            gps: result.gps,
            camera: result.camera
          });
        });

        logger.debug('Batch metadata extracted', { 
          batchNumber: Math.floor(i / batchSize) + 1,
          batchSize: batch.length,
          totalProcessed: allResults.length
        });
      }

      logger.info('All metadata extracted', { 
        total: allResults.length,
        withGPS: allResults.filter(r => r.gps).length
      });

      return allResults;
      
    } catch (error) {
      logger.error('Failed to extract batch metadata', { 
        error: error.message 
      });
      
      // Fallback: extract individually
      logger.warn('Falling back to individual metadata extraction');
      const results = [];
      
      // ✅ FIX: Handle objects in fallback too
      const actualPaths = imagePaths.map(item => 
        typeof item === 'string' ? item : item.path
      );
      
      for (const imagePath of actualPaths) {
        const metadata = await this.extractMetadata(imagePath);
        results.push({
          path: imagePath,
          ...metadata
        });
      }
      return results;
    }
  }

  /**
   * Check if two timestamps are within the specified number of seconds
   */
  areWithinSeconds(timestamp1, timestamp2, seconds = 5) {
    if (!timestamp1 || !timestamp2) return false;
    
    const diff = Math.abs(timestamp1 - timestamp2);
    const threshold = seconds * 1000;
    
    return diff <= threshold;
  }

  /**
   * Format timestamp for display
   */
  formatTimestamp(timestampMs) {
    if (!timestampMs) return 'Unknown';
    
    const date = new Date(timestampMs);
    return date.toLocaleString();
  }

  /**
   * Format GPS coordinates for display
   */
  formatGPS(gps) {
    if (!gps) return null;
    
    return {
      latitude: gps.latitude.toFixed(6),
      longitude: gps.longitude.toFixed(6),
      mapsUrl: `https://www.google.com/maps?q=${gps.latitude},${gps.longitude}`
    };
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.cache.clear();
  }
}

module.exports = ExifExtractor;


