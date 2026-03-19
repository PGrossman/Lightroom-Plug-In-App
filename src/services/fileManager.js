// src/services/fileManager.js
const path = require('path');
const fs = require('fs').promises;
const logger = require('../utils/logger');

class FileManager {
  constructor() {
    // Temporarily enable debug logging for derivative detection
    logger.level = 'debug';
    
    // RAW formats from various camera manufacturers
    this.baseExtensions = [
      '.CR2', '.CR3',  // Canon
      '.NEF',          // Nikon
      '.ARW', '.SRF',  // Sony
      '.DNG',          // Adobe/Universal
      '.RAF',          // Fujifilm
      '.ORF',          // Olympus
      '.RW2',          // Panasonic
      '.PEF',          // Pentax
      '.ERF'           // Epson
    ];
    
    // Derivative/edited file formats
    this.derivativeExtensions = [
      '.tif', '.tiff',
      '.jpg', '.jpeg',
      '.png',
      '.psd',
      '.psb'
    ];
  }

  /**
   * Extract base filename from any image
   * Works with multiple camera formats:
   *   - Canon: _GP_0215, _MG_9194, IMG_1234, DSC_0001
   *   - RED: A006_C001_0315GH_S000.0000127 OR A006_C001_0315GH.0000127 (merged)
   * 
   * Examples:
   *   Canon:
   *     _GP_0215.CR2 → _GP_0215
   *     _GP_0215_adj.tif → _GP_0215
   *     _GP_0215_adj-Edit-2.tif → _GP_0215
   *   
   *   RED:
   *     A006_C001_0315GH_S000.0000127.tif → A006_C001_0315GH_S000.0000127
   *     A006_C001_0315GH.0000127.tif → A006_C001_0315GH.0000127 (merged)
   *     A006_C001_0315GH_S000.0000127-Edit.tif → A006_C001_0315GH_S000.0000127
   */
  getBaseFilename(filename) {
    // Remove extension first
    const nameWithoutExt = path.parse(filename).name;
    
    // Pattern 1: RED camera files (X###_X###_XXXXXX_... with OPTIONAL _S###)
    // Format: Camera_Magazine_Hash_[Optional S###]_Frame (e.g., A006_C001_0315GH_S000.0000127 OR A006_C001_0315GH.0000127)
    const redPattern = /^([A-Z]\d{3}_[A-Z]\d{3}_[A-Z0-9]{6}(?:_S\d{3})?\.\d+)/i;
    const redMatch = nameWithoutExt.match(redPattern);
    
    if (redMatch) {
      // RED file - extract full base before any -Edit suffix
      const fullBase = redMatch[1];
      return fullBase.split('-')[0];
    }
    
    // Pattern 2: Canon RAW files (_XX_####)
    // Extract everything before first hyphen or underscore+suffix pattern
    const canonPattern = /^([A-Z_-]*\d+)/i;
    const canonMatch = nameWithoutExt.match(canonPattern);
    
    if (canonMatch) {
      return canonMatch[1];
    }
    
    // Fallback: split on hyphen and take first part
    return nameWithoutExt.split('-')[0];
  }

  /**
   * Check if file is a base RAW image
   * Supports:
   *   - Standard RAW formats (CR2, CR3, NEF, ARW, etc.)
   *   - RED camera TIF files (with or without _S### sequence)
   */
  isBaseImage(filename) {
    const ext = path.extname(filename).toUpperCase();
    
    // Additional check: TIF/TIFF files are only base if they match RED pattern
    if (ext === '.TIF' || ext === '.TIFF') {
      const nameWithoutExt = path.parse(filename).name;
      // ✅ FIX: Make _S### optional to support merged RED files
      const redPattern = /^[A-Z]\d{3}_[A-Z]\d{3}_[A-Z0-9]{6}(_S\d{3})?\.\d+$/i;
      return redPattern.test(nameWithoutExt);
    }
    
    return this.baseExtensions.includes(ext);
  }

  /**
   * Check if file is a potential derivative
   * Includes: .tif, .tiff, .psd, .jpg, .jpeg, .png, .psb
   * Excludes: RED base TIF files (matching specific pattern)
   */
  isDerivative(filename) {
    const ext = path.extname(filename).toLowerCase();
    
    // Check if extension is in derivative list
    if (!this.derivativeExtensions.includes(ext)) {
      return false;
    }
    
    // If it's a TIF/TIFF, check if it's a RED base file
    if (ext === '.tif' || ext === '.tiff') {
      const nameWithoutExt = path.parse(filename).name;
      // ✅ FIX: Updated pattern to handle both bracketed and merged RED files
      const redBasePattern = /^[A-Z]\d{3}_[A-Z]\d{3}_[A-Z0-9]{6}(_S\d{3})?\.\d+$/i;
      
      // If it matches the EXACT RED base pattern (with optional S###), it's NOT a derivative
      if (redBasePattern.test(nameWithoutExt)) {
        return false;
      }
      
      // If it has "-Edit" or "-Pano" or other suffixes, it IS a derivative
      // Examples: A006_C001_0315GH_S000.0000127-Edit.tif = derivative
      //           A006_C001_0315GH.0000127-Edit.tif = derivative
      //           _GP_4599-Pano-Edit-Edit-Edit.tif = derivative
      return true;
    }
    
    // PSD files are ALWAYS derivatives
    if (ext === '.psd' || ext === '.psb') {
      return true;
    }
    
    return true;
  }

  /**
   * Find all derivatives for a base image
   * Compares base filenames to find matches
   */
  findDerivatives(baseFilename, allFiles, basePath) {
    const derivatives = [];
    const baseDir = path.dirname(basePath);
    
    logger.debug('Finding derivatives', { 
      baseFilename, 
      basePath: path.basename(basePath),
      totalFilesToCheck: allFiles.length 
    });
    
    for (const file of allFiles) {
      // Skip the base file itself
      if (file === basePath) continue;
      
      // Only check potential derivatives
      if (!this.isDerivative(path.basename(file))) continue;
      
      // Check if in same directory (or handle subdirectories if needed)
      if (path.dirname(file) !== baseDir) continue;
      
      const fileBase = this.getBaseFilename(path.basename(file));
      
      // DEBUG: Log every comparison for _GP_0215
      if (baseFilename === '_GP_0215') {
        logger.debug('Checking file for _GP_0215', { 
          file: path.basename(file),
          extractedBase: fileBase,
          matches: fileBase === baseFilename
        });
      }
      
      if (fileBase === baseFilename) {
        derivatives.push(file);
      }
    }
    
    logger.debug('Derivatives found for base', { 
      baseFilename,
      count: derivatives.length,
      derivatives: derivatives.map(d => path.basename(d))
    });
    
    return derivatives;
  }

  /**
   * Recursively walk directory and yield all files
   */
  async *walkDirectory(dir) {
    try {
      const files = await fs.readdir(dir, { withFileTypes: true });
      
      for (const file of files) {
        // Skip hidden files and system files
        if (file.name.startsWith('.') || file.name.startsWith('__')) {
          continue;
        }
        
        const fullPath = path.join(dir, file.name);
        
        if (file.isDirectory()) {
          // Recurse into subdirectories
          yield* this.walkDirectory(fullPath);
        } else {
          yield fullPath;
        }
      }
    } catch (error) {
      logger.error('Error walking directory', { dir, error: error.message });
      throw error;
    }
  }

  /**
   * ✅ FIX: NEW METHOD - Sort files consistently (alphabetically by basename)
   * This ensures TIF and CR2 files appear in the same order regardless of filesystem
   */
  sortFilesAlphabetically(files) {
    return files.sort((a, b) => {
      const baseA = path.basename(a).toLowerCase();
      const baseB = path.basename(b).toLowerCase();
      return baseA.localeCompare(baseB, undefined, { 
        numeric: true,  // Handle numbers correctly (_GP_0001 before _GP_0010)
        sensitivity: 'base'  // Case-insensitive
      });
    });
  }

  /**
   * Scan directory and build file tree
   * Returns: { baseImages: [...], derivatives: Map, stats: {...} }
   */
  async scanDirectory(dirPath) {
    logger.info('Starting directory scan', { dirPath });
    
    const startTime = Date.now();
    const results = {
      baseImages: [],
      derivatives: new Map(), // baseImage path → [derivative paths]
      stats: {
        totalFiles: 0,
        baseImagesFound: 0,
        derivativesFound: 0,
        skippedFiles: 0,
        orphansPromoted: 0
      }
    };

    // Step 1: Collect all files
    const allFiles = [];
    for await (const file of this.walkDirectory(dirPath)) {
      allFiles.push(file);
      results.stats.totalFiles++;
    }

    // ✅ FIX: Sort files alphabetically for consistent ordering
    const sortedFiles = this.sortFilesAlphabetically(allFiles);

    // Count file extensions
    const extCounts = {};
    sortedFiles.forEach(file => {
      const ext = path.extname(file).toLowerCase();
      extCounts[ext] = (extCounts[ext] || 0) + 1;
    });
    
    logger.info('All files found and sorted', { 
      count: sortedFiles.length,
      extensions: extCounts,
      sample: sortedFiles.slice(0, 10).map(f => path.basename(f))
    });

    // Step 2: Identify base images (use sortedFiles instead of allFiles)
    let tifBaseCount = 0;
    let tifDerivativeCount = 0;
    let tifUnknownCount = 0;
    
    for (const file of sortedFiles) {
      const filename = path.basename(file);
      const ext = path.extname(filename).toUpperCase();
      
      // Log RED TIF candidates
      if (ext === '.TIF' || ext === '.TIFF') {
        const isBase = this.isBaseImage(filename);
        const isDeriv = this.isDerivative(filename);
        logger.debug('TIF file check', { 
          filename, 
          isBase,
          isDerivative: isDeriv,
          extractedBase: this.getBaseFilename(filename)
        });
        
        if (isBase) tifBaseCount++;
        else if (isDeriv) tifDerivativeCount++;
        else tifUnknownCount++;
      }
      
      if (this.isBaseImage(filename)) {
        results.baseImages.push(file);
        results.stats.baseImagesFound++;
      }
    }
    
    if (tifBaseCount > 0 || tifDerivativeCount > 0 || tifUnknownCount > 0) {
      logger.info('TIF file classification', { 
        tifBase: tifBaseCount,
        tifDerivative: tifDerivativeCount,
        tifUnknown: tifUnknownCount
      });
    }

    logger.info('Base images identified', { 
      count: results.baseImages.length,
      redFiles: results.baseImages.filter(f => /\.tiff?$/i.test(f)).length,
      canonFiles: results.baseImages.filter(f => /\.(cr2|cr3)$/i.test(f)).length
    });

    // Step 3: Find derivatives for each base
    for (const baseImage of results.baseImages) {
      const baseFilename = this.getBaseFilename(path.basename(baseImage));
      const derivatives = this.findDerivatives(baseFilename, sortedFiles, baseImage);
      
      results.derivatives.set(baseImage, derivatives);
      results.stats.derivativesFound += derivatives.length;
      
      if (derivatives.length > 0) {
        logger.debug('Derivatives found', { 
          baseImage: path.basename(baseImage),
          count: derivatives.length,
          derivatives: derivatives.map(d => path.basename(d))
        });
      }
    }

    // ✅ NEW STEP 4: Promote orphaned derivatives to base images
    const allDerivativeFiles = new Set();
    for (const derivs of results.derivatives.values()) {
      derivs.forEach(d => allDerivativeFiles.add(d));
    }
    
    // Find potential derivatives that weren't attached to any base
    const orphanedDerivatives = [];
    for (const file of sortedFiles) {
      const filename = path.basename(file);
      if (this.isDerivative(filename) && !allDerivativeFiles.has(file)) {
        orphanedDerivatives.push(file);
      }
    }
    
    if (orphanedDerivatives.length > 0) {
      logger.info('🔄 Promoting orphaned derivatives to base images', {
        count: orphanedDerivatives.length,
        files: orphanedDerivatives.map(f => path.basename(f))
      });
      
      // Promote orphans to base images
      orphanedDerivatives.forEach(orphan => {
        results.baseImages.push(orphan);
        results.derivatives.set(orphan, []); // No derivatives for orphans
        results.stats.baseImagesFound++;
        results.stats.orphansPromoted++;
      });
    }

    const duration = Date.now() - startTime;
    results.stats.scanDuration = duration;
    
    logger.info('Directory scan complete', {
      duration: `${duration}ms`,
      baseImages: results.stats.baseImagesFound,
      derivatives: results.stats.derivativesFound,
      orphansPromoted: results.stats.orphansPromoted,
      totalFiles: results.stats.totalFiles
    });

    return results;
  }

  /**
   * Scan a specific list of files (no directory walk)
   * Only the provided files are considered; no additional files are pulled in
   */
  async scanFiles(filePaths) {
    logger.info('Starting file list scan', { files: filePaths.length });
    const startTime = Date.now();
    const results = {
      baseImages: [],
      derivatives: new Map(),
      stats: {
        totalFiles: filePaths.length,
        baseImagesFound: 0,
        derivativesFound: 0,
        skippedFiles: 0,
        orphansPromoted: 0
      }
    };

    // Normalize to absolute unique paths and sort
    const uniqueFiles = Array.from(new Set(filePaths)).filter(Boolean);
    const sortedFiles = this.sortFilesAlphabetically(uniqueFiles);

    // Identify base images within provided set
    for (const file of sortedFiles) {
      const filename = path.basename(file);
      if (this.isBaseImage(filename)) {
        results.baseImages.push(file);
        results.stats.baseImagesFound++;
      }
    }

    // No derivative discovery outside provided set
    for (const baseImage of results.baseImages) {
      results.derivatives.set(baseImage, []);
    }

    // Promote provided derivatives so user-dropped JPG/PNG/TIF still appear
    const providedSet = new Set(sortedFiles);
    for (const file of sortedFiles) {
      const filename = path.basename(file);
      const isProvidedDerivative = this.isDerivative(filename);
      if (isProvidedDerivative && !results.baseImages.includes(file)) {
        results.baseImages.push(file);
        results.derivatives.set(file, []);
        results.stats.baseImagesFound++;
        results.stats.orphansPromoted++;
      }
    }

    const duration = Date.now() - startTime;
    results.stats.scanDuration = duration;
    logger.info('File list scan complete', {
      duration: `${duration}ms`,
      baseImages: results.stats.baseImagesFound,
      totalFiles: results.stats.totalFiles
    });

    return results;
  }

  /**
   * Cluster a provided list of files using the same logic as directory scan
   */
  async scanFilesWithClustering(filePaths, timestampThreshold = 5) {
    const scanResults = await this.scanFiles(filePaths);

    // Separate RED from Canon files
    const redFiles = [];
    const canonFiles = [];
    for (const baseImage of scanResults.baseImages) {
      const filename = path.basename(baseImage);
      const stat = await (await require('fs')).promises.stat(baseImage).catch(() => null);
      const fileObj = { name: filename, path: baseImage, stat: stat || { mtime: new Date(0) } };
      if (this.isREDFile(filename)) redFiles.push(fileObj); else canonFiles.push(fileObj);
    }

    const redClusters = this.clusterREDFiles(redFiles);

    const ExifExtractor = require('./exifExtractor');
    const ClusteringService = require('./clusteringService');
    const exifExtractor = new ExifExtractor();
    const clusteringService = new ClusteringService(exifExtractor);

    let canonClusters = [];
    if (canonFiles.length > 0) {
      try {
        canonClusters = await clusteringService.clusterByTimestamp(
          canonFiles.map(f => f.path),
          timestampThreshold
        );
        if (!Array.isArray(canonClusters)) canonClusters = [];
      } catch {
        canonClusters = [];
      }
    }

    const formattedCanonClusters = canonClusters.map((cluster, index) => 
      clusteringService.formatClusterForDisplay(cluster, index)
    );

    const formattedREDClusters = redClusters.map(cluster => ({ ...cluster, derivatives: [] }));
    const allClusters = [...formattedREDClusters, ...formattedCanonClusters];

    const totalImages = allClusters.reduce((sum, c) => sum + c.imageCount, 0);
    const clusterStats = {
      totalClusters: allClusters.length,
      totalImages: totalImages,
      redClusters: redClusters.length,
      canonClusters: formattedCanonClusters.length,
      bracketedClusters: allClusters.filter(c => c.isBracketed).length,
      singletonClusters: allClusters.filter(c => !c.isBracketed).length,
      averageClusterSize: allClusters.length > 0 ? totalImages / allClusters.length : 0
    };

    return {
      ...scanResults,
      clusters: allClusters,
      clusterStats,
      summary: {
        totalBaseImages: scanResults.stats.baseImagesFound,
        totalDerivatives: 0,
        orphansPromoted: scanResults.stats.orphansPromoted,
        totalClusters: allClusters.length,
        redClusters: redClusters.length,
        canonClusters: formattedCanonClusters.length,
        bracketedClusters: allClusters.filter(c => c.isBracketed).length,
        singletonClusters: allClusters.filter(c => !c.isBracketed).length
      }
    };
  }

  /**
   * Get a summary of scan results for display
   */
  getScanSummary(scanResults) {
    const summary = {
      totalFiles: scanResults.stats.totalFiles,
      totalBaseImages: scanResults.stats.baseImagesFound,
      totalDerivatives: scanResults.stats.derivativesFound,
      orphansPromoted: scanResults.stats.orphansPromoted || 0,
      imagesWithDerivatives: 0,
      standaloneImages: 0,
      scanDuration: scanResults.stats.scanDuration
    };

    for (const [baseImage, derivatives] of scanResults.derivatives) {
      if (derivatives.length > 0) {
        summary.imagesWithDerivatives++;
      } else {
        summary.standaloneImages++;
      }
    }

    return summary;
  }

  /**
   * Check if filename matches RED camera pattern
   * ✅ FIX: Supports both bracketed and merged files
   * Pattern: A006_C001_0315GH_S000.0000127.tif OR A006_C001_0315GH.0000127.tif
   */
  isREDFile(filename) {
    // Make _S### optional with (_S\d{3})?
    return /^A\d{3}_C\d{3}_[A-Z0-9]+(_S\d{3})?\.\d+\.tiff?$/i.test(filename);
  }

  /**
   * Parse RED camera filename into components
   * ✅ FIX: Handles both bracketed and merged files
   * Returns: { camera, mag, jobCode, sequence, frame, baseIdentifier }
   */
  parseREDFilename(filename) {
    // Make sequence group optional: (?:_(S\d{3}))?
    const match = filename.match(/^(A\d{3})_(C\d{3})_([A-Z0-9]+)(?:_(S\d{3}))?\.(\d+)\.tiff?$/i);
    if (!match) return null;
    
    return {
      camera: match[1],        // A006
      mag: match[2],           // C001
      jobCode: match[3],       // 0315GH
      sequence: match[4] || 'MERGED',  // S000 or 'MERGED' if not present
      frame: match[5],         // 0000127
      baseIdentifier: `${match[1]}_${match[2]}_${match[3]}_${match[5]}` // A006_C001_0315GH_0000127
    };
  }

  /**
   * Cluster RED files by naming pattern
   * Groups by camera + mag + jobCode + frame
   * Different S### numbers with same frame = bracketed shots
   * Merged files (no S###) = part of the bracketed cluster
   */
  clusterREDFiles(redFiles) {
    const clusters = new Map();
    
    for (const file of redFiles) {
      const parsed = this.parseREDFilename(path.basename(file.path));
      if (!parsed) continue;
      
      // Group by baseIdentifier (camera + mag + jobCode + frame)
      // Different S### numbers with same frame = bracketed shots
      if (!clusters.has(parsed.baseIdentifier)) {
        clusters.set(parsed.baseIdentifier, []);
      }
      clusters.get(parsed.baseIdentifier).push(file);
    }
    
    return Array.from(clusters.values()).map(files => {
      // Sort by sequence number (S000, S001, S002, or MERGED)
      files.sort((a, b) => {
        const seqA = this.parseREDFilename(path.basename(a.path)).sequence;
        const seqB = this.parseREDFilename(path.basename(b.path)).sequence;
        return seqA.localeCompare(seqB);
      });
      
      // CRITICAL FIX: Use full paths for both images and imagePaths
      const fullPaths = files.map(f => f.path);
      
      return {
        representative: fullPaths[0], // ✅ Full path
        representativeFilename: path.basename(fullPaths[0]),
        images: fullPaths, // ✅ CHANGED: Full paths, not basenames
        imagePaths: fullPaths, // ✅ Full paths
        imageCount: files.length,
        isBracketed: files.length > 1,
        fileType: 'RED',
        hasGPS: false,
        startTime: Math.min(...files.map(f => f.stat.mtime.getTime())),
        endTime: Math.max(...files.map(f => f.stat.mtime.getTime()))
      };
    });
  }

  /**
   * Scan directory with timestamp clustering
   * Combines file detection with timestamp-based grouping
   * Supports both Canon (timestamp-based) and RED (pattern-based) clustering
   */
  async scanDirectoryWithClustering(dirPath, timestampThreshold = 5) {
    logger.info('Starting enhanced scan with clustering', { dirPath, timestampThreshold });
    
    // First, do normal file scan
    const scanResults = await this.scanDirectory(dirPath);
    
    // Separate RED from Canon files
    const redFiles = [];
    const canonFiles = [];
    
    for (const baseImage of scanResults.baseImages) {
      const filename = path.basename(baseImage);
      const stat = await fs.stat(baseImage);
      
      const fileObj = {
        name: filename,
        path: baseImage,
        stat: stat
      };
      
      if (this.isREDFile(filename)) {
        redFiles.push(fileObj);
      } else {
        canonFiles.push(fileObj);
      }
    }
    
    logger.info('Files separated by type', { 
      redFiles: redFiles.length, 
      canonFiles: canonFiles.length 
    });
    
    // Cluster RED files by pattern
    const redClusters = this.clusterREDFiles(redFiles);
    logger.info('RED clustering complete', { clusters: redClusters.length });
    
    // Import clustering services for Canon files
    const ExifExtractor = require('./exifExtractor');
    const ClusteringService = require('./clusteringService');
    
    const exifExtractor = new ExifExtractor();
    const clusteringService = new ClusteringService(exifExtractor);
    
    // Cluster Canon files by timestamp (pass paths only, and await)
    let canonClusters = [];
    if (canonFiles.length > 0) {
      try {
        canonClusters = await clusteringService.clusterByTimestamp(
          canonFiles.map(f => f.path),
          timestampThreshold
        );
        
        // Validate return value
        if (!Array.isArray(canonClusters)) {
          logger.error('clusterByTimestamp did not return an array', { 
            returned: typeof canonClusters,
            value: canonClusters 
          });
          canonClusters = [];
        }
        
        logger.info('Canon clustering complete', { clusters: canonClusters.length });
      } catch (error) {
        logger.error('Canon clustering failed', { error: error.message });
        canonClusters = [];
      }
    }
    
    // Format Canon clusters for display
    const formattedCanonClusters = canonClusters.map((cluster, index) => 
      clusteringService.formatClusterForDisplay(cluster, index)
    );
    
    // Format RED clusters with derivatives  
    const formattedREDClusters = redClusters.map(cluster => {
      const clusterDerivatives = scanResults.derivatives.get(cluster.representative) || [];
      return {
        ...cluster,
        derivatives: clusterDerivatives
      };
    });
    
    // Combine all clusters
    const allClusters = [...formattedREDClusters, ...formattedCanonClusters];
    
    // Calculate combined statistics
    const totalImages = allClusters.reduce((sum, c) => sum + c.imageCount, 0);
    const clusterStats = {
      totalClusters: allClusters.length,
      totalImages: totalImages,
      redClusters: redClusters.length,
      canonClusters: formattedCanonClusters.length,
      bracketedClusters: allClusters.filter(c => c.isBracketed).length,
      singletonClusters: allClusters.filter(c => !c.isBracketed).length,
      averageClusterSize: allClusters.length > 0 ? totalImages / allClusters.length : 0
    };
    
    logger.info('Combined clustering complete', clusterStats);
    
    return {
      ...scanResults,
      clusters: allClusters,
      clusterStats: clusterStats,
      summary: {
        totalBaseImages: scanResults.stats.baseImagesFound,
        totalDerivatives: scanResults.stats.derivativesFound,
        orphansPromoted: scanResults.stats.orphansPromoted,
        totalClusters: allClusters.length,
        redClusters: redClusters.length,
        canonClusters: formattedCanonClusters.length,
        bracketedClusters: allClusters.filter(c => c.isBracketed).length,
        singletonClusters: allClusters.filter(c => !c.isBracketed).length
      }
    };
  }

  /**
   * DEBUG: Test derivative detection for specific files
   */
  testDerivativeDetection() {
    const testFiles = [
      '_GP_0215.CR2',
      '_GP_0215_adj.tif',
      '_GP_0215_adj-Edit.tif',
      '_GP_0215_adj-Edit-2.tif',
      '_GP_0215_adj-Edit-Edit.tif',
      '_GP_0215_adj-Edit-Edit-Edit.psd'
    ];
    
    logger.info('=== Testing derivative detection for _GP_0215 ===');
    testFiles.forEach(file => {
      const base = this.getBaseFilename(file);
      const isBase = this.isBaseImage(file);
      const isDeriv = this.isDerivative(file);
      logger.info(`File: ${file}`, {
        extractedBase: base,
        isBaseImage: isBase,
        isDerivative: isDeriv,
        shouldMatch: base === '_GP_0215'
      });
    });
    logger.info('=== End of derivative detection test ===');
  }
}

module.exports = FileManager;
