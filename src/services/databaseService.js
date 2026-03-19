// src/services/databaseService.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

class DatabaseService {
  constructor() {
    this.db = null;
    this.dbPath = null;
  }

  /**
   * Initialize database at specified location
   * Creates database file and tables if they don't exist
   */
  initialize(dbPath) {
    try {
      // Ensure directory exists
      const dbDir = path.dirname(dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Connect to database (creates file if doesn't exist)
      this.db = new Database(dbPath, { verbose: logger.debug });
      this.dbPath = dbPath;

      // Create tables
      this.createTables();

      logger.info('Database initialized', { dbPath });
      return { success: true, dbPath };

    } catch (error) {
      logger.error('Database initialization failed', { dbPath, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Create database tables if they don't exist
   */
  createTables() {
    // Images table - stores base image information
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS images (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE NOT NULL,
        file_name TEXT NOT NULL,
        directory TEXT NOT NULL,
        file_size INTEGER,
        capture_timestamp INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      )
    `);

    // Derivatives table - stores edited/processed versions
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS derivatives (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        parent_image_id INTEGER NOT NULL,
        file_path TEXT UNIQUE NOT NULL,
        file_name TEXT NOT NULL,
        file_type TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (parent_image_id) REFERENCES images(id) ON DELETE CASCADE
      )
    `);

    // Clusters table - stores timestamp-based groupings
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clusters (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        representative_image_id INTEGER NOT NULL,
        start_timestamp INTEGER,
        end_timestamp INTEGER,
        image_count INTEGER,
        is_bracketed BOOLEAN DEFAULT 0,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (representative_image_id) REFERENCES images(id) ON DELETE CASCADE
      )
    `);

    // Cluster members table - maps images to clusters
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cluster_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cluster_id INTEGER NOT NULL,
        image_id INTEGER NOT NULL,
        FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE,
        UNIQUE(cluster_id, image_id)
      )
    `);

    // Analysis results table - stores AI/Ollama analysis
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS analysis_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_id INTEGER NOT NULL,
        analysis_method TEXT,
        subjects TEXT,
        scene_type TEXT,
        keywords TEXT,
        description TEXT,
        confidence REAL,
        analyzed_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      )
    `);

    // Processing status table - tracks processing pipeline
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processing_status (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_id INTEGER NOT NULL,
        stage TEXT NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        processed_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE CASCADE
      )
    `);

    // Personal data table - stores creator and copyright information
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS personal_data (
        id INTEGER PRIMARY KEY,
        creatorName TEXT NOT NULL,
        jobTitle TEXT,
        address TEXT,
        city TEXT,
        state TEXT,
        postalCode TEXT,
        country TEXT,
        phone TEXT,
        email TEXT NOT NULL,
        website TEXT,
        copyrightStatus TEXT DEFAULT 'copyrighted',
        copyrightNotice TEXT NOT NULL,
        rightsUsageTerms TEXT,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes for better performance
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_images_path ON images(file_path);
      CREATE INDEX IF NOT EXISTS idx_images_timestamp ON images(capture_timestamp);
      CREATE INDEX IF NOT EXISTS idx_derivatives_parent ON derivatives(parent_image_id);
      CREATE INDEX IF NOT EXISTS idx_cluster_members_cluster ON cluster_members(cluster_id);
      CREATE INDEX IF NOT EXISTS idx_cluster_members_image ON cluster_members(image_id);
      CREATE INDEX IF NOT EXISTS idx_analysis_image ON analysis_results(image_id);
      CREATE INDEX IF NOT EXISTS idx_processing_image ON processing_status(image_id);
    `);

    logger.info('Database tables created/verified');
  }

  /**
   * Check if database exists at path
   */
  static databaseExists(dbPath) {
    return fs.existsSync(dbPath);
  }

  /**
   * Clear all records from database (for testing)
   */
  clearAllRecords() {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const transaction = this.db.transaction(() => {
        this.db.exec('DELETE FROM processing_status');
        this.db.exec('DELETE FROM analysis_results');
        this.db.exec('DELETE FROM cluster_members');
        this.db.exec('DELETE FROM clusters');
        this.db.exec('DELETE FROM derivatives');
        this.db.exec('DELETE FROM images');
        
        // Reset auto-increment counters
        this.db.exec('DELETE FROM sqlite_sequence');
      });

      transaction();

      logger.info('Database cleared - all records deleted');
      return { success: true, message: 'Database cleared successfully' };

    } catch (error) {
      logger.error('Failed to clear database', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Get database statistics
   */
  getStats() {
    if (!this.db) {
      return null;
    }

    try {
      const stats = {
        images: this.db.prepare('SELECT COUNT(*) as count FROM images').get().count,
        derivatives: this.db.prepare('SELECT COUNT(*) as count FROM derivatives').get().count,
        clusters: this.db.prepare('SELECT COUNT(*) as count FROM clusters').get().count,
        analyzed: this.db.prepare('SELECT COUNT(*) as count FROM analysis_results').get().count
      };

      return stats;
    } catch (error) {
      logger.error('Failed to get database stats', { error: error.message });
      return null;
    }
  }

  /**
   * Save or update an image record with GPS and metadata
   */
  saveImage(imagePath, metadata = {}) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const stmt = this.db.prepare(`
        INSERT INTO images (file_path, file_name, directory, file_size, capture_timestamp)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          file_name = excluded.file_name,
          directory = excluded.directory,
          file_size = excluded.file_size,
          capture_timestamp = excluded.capture_timestamp,
          updated_at = strftime('%s', 'now')
      `);

      const fileName = path.basename(imagePath);
      const directory = path.dirname(imagePath);

      const result = stmt.run(
        imagePath,
        fileName,
        directory,
        metadata.fileSize || null,
        metadata.timestamp || null
      );

      // Get the image ID (either newly inserted or existing)
      // CRITICAL: After upsert, always query for the correct ID
      const imageRow = this.db.prepare('SELECT id FROM images WHERE file_path = ?').get(imagePath);
      const imageId = imageRow.id;

      // Save GPS data if provided
      if (metadata.gps) {
        this.saveGPS(imageId, metadata.gps);
      }

      // Save keywords if provided
      if (metadata.keywords) {
        this.saveKeywords(imageId, metadata.keywords);
      }

      return { success: true, imageId };

    } catch (error) {
      logger.error('Failed to save image', { imagePath, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Save GPS coordinates for an image (stored in analysis_results for now)
   * TODO: Consider adding dedicated GPS table in future
   */
  saveGPS(imageId, gps) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const stmt = this.db.prepare(`
        INSERT INTO analysis_results (image_id, analysis_method, keywords)
        VALUES (?, 'gps', ?)
        ON CONFLICT(image_id) DO UPDATE SET
          keywords = excluded.keywords
      `);

      const gpsData = JSON.stringify({
        latitude: gps.latitude,
        longitude: gps.longitude
      });

      stmt.run(imageId, gpsData);
      
      logger.debug('GPS data saved', { imageId, gps });
      return { success: true };

    } catch (error) {
      logger.error('Failed to save GPS', { imageId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Save folder keywords for an image
   */
  saveKeywords(imageId, keywords) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      // Store as JSON string in keywords field
      const keywordData = Array.isArray(keywords) 
        ? keywords.join(', ')
        : keywords;

      const stmt = this.db.prepare(`
        INSERT INTO analysis_results (image_id, analysis_method, keywords)
        VALUES (?, 'folder_keywords', ?)
      `);

      stmt.run(imageId, keywordData);
      
      logger.debug('Keywords saved', { imageId, count: keywords.length || 0 });
      return { success: true };

    } catch (error) {
      logger.error('Failed to save keywords', { imageId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Save perceptual hash for an image
   */
  savePerceptualHash(imageId, hash, previewPath = null) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const stmt = this.db.prepare(`
        UPDATE processing_status
        SET status = 'hashed', error_message = ?
        WHERE image_id = ? AND stage = 'processing'
      `);

      const hashData = JSON.stringify({ hash, previewPath });
      stmt.run(hashData, imageId);

      logger.debug('Perceptual hash saved', { imageId });
      return { success: true };

    } catch (error) {
      logger.error('Failed to save hash', { imageId, error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Save complete processing results for a batch of images
   */
  saveProcessingResults(results) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    if (!Array.isArray(results) || results.length === 0) {
      logger.warn('No results to save', { resultsCount: results?.length || 0 });
      return { success: true, saved: 0, failed: 0 };
    }

    try {
      const transaction = this.db.transaction((resultsArray) => {
        let saved = 0;
        let failed = 0;
        const errors = [];

        for (const result of resultsArray) {
          try {
            // Validate required fields
            if (!result.path) {
              throw new Error('Missing required field: path');
            }

            // CRITICAL: Only save successful results
            if (result.success === false) {
              logger.debug('Skipping failed result', { path: result.path, error: result.error });
              failed++;
              continue;
            }

            // Save image with metadata
            const imageResult = this.saveImage(result.path, {
              timestamp: result.timestamp,
              gps: result.gps,
              keywords: result.keywords,
              fileSize: result.fileSize
            });

            if (!imageResult.success) {
              throw new Error(`Image save failed: ${imageResult.error}`);
            }

            // Save perceptual hash if available
            if (result.hash && imageResult.imageId) {
              this.savePerceptualHash(imageResult.imageId, result.hash, result.previewPath);
            }

            saved++;
            logger.debug('Result saved successfully', { 
              path: result.path, 
              imageId: imageResult.imageId 
            });

          } catch (err) {
            failed++;
            const errorInfo = { 
              path: result.path, 
              error: err.message,
              stack: err.stack 
            };
            errors.push(errorInfo);
            logger.error('Failed to save result', errorInfo);
          }
        }

        // Log summary
        if (failed > 0) {
          logger.warn('Some results failed to save', { 
            saved, 
            failed, 
            errorCount: errors.length,
            firstError: errors[0]?.error 
          });
        }

        return { saved, failed, errors };
      });

      const stats = transaction(results);

      logger.info('Processing results saved', { 
        total: results.length,
        saved: stats.saved, 
        failed: stats.failed,
        successRate: `${Math.round((stats.saved / results.length) * 100)}%`
      });
      
      return { success: true, ...stats };

    } catch (error) {
      logger.error('Transaction failed, rolling back', { 
        error: error.message,
        stack: error.stack,
        resultsCount: results.length
      });
      return { 
        success: false, 
        error: error.message,
        saved: 0,
        failed: results.length
      };
    }
  }

  /**
   * Get image by path
   */
  getImageByPath(imagePath) {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const stmt = this.db.prepare('SELECT * FROM images WHERE file_path = ?');
      return stmt.get(imagePath);
    } catch (error) {
      logger.error('Failed to get image', { imagePath, error: error.message });
      return null;
    }
  }

  /**
   * Close database connection
   */
  close() {
    if (this.db) {
      this.db.close();
      logger.info('Database connection closed');
    }
  }

  /**
   * Get database file size
   */
  getFileSize() {
    if (!this.dbPath || !fs.existsSync(this.dbPath)) {
      return 0;
    }

    const stats = fs.statSync(this.dbPath);
    return stats.size;
  }

  /**
   * Format file size for display
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  }

  /**
   * Get all processed images with their metadata and analysis results
   */
  getAllProcessedImages() {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    try {
      const query = `
        SELECT 
          i.id,
          i.file_path,
          i.file_name,
          i.directory,
          i.file_size,
          i.capture_timestamp,
          i.created_at,
          i.updated_at,
          ar.analysis_method,
          ar.keywords,
          ar.confidence,
          ar.analyzed_at as analysis_created_at
        FROM images i
        LEFT JOIN analysis_results ar ON i.id = ar.image_id
        ORDER BY i.created_at DESC
      `;

      const stmt = this.db.prepare(query);
      const rows = stmt.all();

      // Group by image and collect all analysis results
      const imageMap = new Map();
      
      rows.forEach(row => {
        const imageId = row.id;
        
        if (!imageMap.has(imageId)) {
          imageMap.set(imageId, {
            id: row.id,
            filePath: row.file_path,
            fileName: row.file_name,
            directory: row.directory,
            fileSize: row.file_size,
            captureTimestamp: row.capture_timestamp,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            analysisResults: []
          });
        }

        // Add analysis result if it exists
        if (row.analysis_method) {
          imageMap.get(imageId).analysisResults.push({
            method: row.analysis_method,
            keywords: row.keywords,
            confidenceScore: row.confidence,
            createdAt: row.analysis_created_at
          });
        }
      });

      const processedImages = Array.from(imageMap.values());
      
      logger.info('Retrieved processed images', { 
        count: processedImages.length,
        withAnalysis: processedImages.filter(img => img.analysisResults.length > 0).length
      });

      return {
        success: true,
        images: processedImages,
        totalCount: processedImages.length
      };

    } catch (error) {
      logger.error('Failed to get processed images', { error: error.message });
      return {
        success: false,
        error: error.message,
        images: [],
        totalCount: 0
      };
    }
  }
}

module.exports = DatabaseService;


