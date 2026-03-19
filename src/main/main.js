const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// DEBUG: Add file-based logging
console.log('🚀 MAIN.JS LOADED - VERSION 3.0 - CLIP SIMILARITY ENABLED - NEW CODE LOADED');
// Removed debug.txt writes - causes read-only errors in packaged app
const FileManager = require('../services/fileManager');
const DatabaseService = require('../services/databaseService');
const ConfigManager = require('../services/configManager');
const ExifExtractor = require('../services/exifExtractor');
const ImageProcessor = require('../services/imageProcessor');
const ClusterRefiner = require('../services/clusterRefiner');
const SimilarityDetector = require('../services/similarityDetector');
const ClipServiceManager = require('../services/clipServiceManager');
const AIAnalysisService = require('../services/aiAnalysisService');
const XMPGenerator = require('../services/xmpGenerator');
const SystemCheck = require('../utils/systemCheck');
const logger = require('../utils/logger');

// Initialize services
const fileManager = new FileManager();
const databaseService = new DatabaseService();
const configManager = new ConfigManager();
const exifExtractor = new ExifExtractor();
const imageProcessor = new ImageProcessor();
const similarityDetector = new SimilarityDetector(configManager.getAllSettings());
const clusterRefiner = new ClusterRefiner(imageProcessor);

// Create progress callback for CLIP service setup
const clipProgressCallback = (progressData) => {
  // Send progress updates to all windows
  BrowserWindow.getAllWindows().forEach(window => {
    if (window && !window.isDestroyed()) {
      window.webContents.send('clip-setup-progress', progressData);
    }
  });
};

const clipServiceManager = new ClipServiceManager(clipProgressCallback);

// Initialize AI Analysis Service
let aiAnalysisService = null;

// Splash window reference
let splash = null;

/**
 * Check Apple Silicon GPU (MPS) status
 * Verifies if PyTorch with MPS support is available for GPU acceleration
 */
async function checkGPUStatus() {
  try {
    const { spawn } = require('child_process');
    const PathHelper = require('../utils/pathHelper');
    const pythonPath = PathHelper.getPythonPath();
    
    // Check if Python exists
    if (!fs.existsSync(pythonPath)) {
      logger.info('⚠️  Virtual environment not found - GPU check skipped');
      logger.info('   Run: ./install_pytorch_mps.sh to enable GPU acceleration');
      return null;
    }
    
    logger.info('🔍 Checking Apple Silicon GPU (MPS) status...');
    
    const proc = spawn(pythonPath, ['-c', `
import torch
import json
try:
    print(json.dumps({
        'mps_available': torch.backends.mps.is_available(),
        'mps_built': torch.backends.mps.is_built(),
        'cuda_available': torch.cuda.is_available(),
        'pytorch_version': torch.__version__,
        'device': 'mps' if torch.backends.mps.is_available() else ('cuda' if torch.cuda.is_available() else 'cpu')
    }))
except Exception as e:
    print(json.dumps({'error': str(e)}))
    `]);
    
    let output = '';
    let errorOutput = '';
    
    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { errorOutput += data.toString(); });
    
    await new Promise((resolve) => proc.on('close', resolve));
    
    if (output.trim()) {
      const status = JSON.parse(output.trim());
      
      if (status.error) {
        logger.error('GPU check failed', { error: status.error });
        return null;
      }
      
      if (status.mps_available) {
        logger.info('🚀 Apple Silicon GPU (MPS) is ENABLED!');
        logger.info(`   PyTorch version: ${status.pytorch_version}`);
        logger.info('   CLIP embeddings will use GPU acceleration (3-6x faster)');
      } else if (status.cuda_available) {
        logger.info('🚀 NVIDIA GPU (CUDA) is ENABLED!');
        logger.info(`   PyTorch version: ${status.pytorch_version}`);
      } else {
        logger.warn('⚠️  GPU acceleration not available - using CPU');
        logger.warn('   For better performance on Apple Silicon:');
        logger.warn('   Run: ./install_pytorch_mps.sh');
      }
      
      return status;
    }
    
    return null;
  } catch (error) {
    logger.error('Failed to check GPU status', { error: error.message });
    return null;
  }
}

async function initializeAIServices() {
  try {
    const config = configManager.getAllSettings();
    
    // Validate config has required sections
    if (!config.ollama) {
      config.ollama = {
        endpoint: 'http://localhost:11434',
        model: 'qwen2.5vl:latest',
        temperature: 0.1,
        timeout: 60000
      };
    }
    
    if (!config.aiAnalysis) {
      config.aiAnalysis = {
        confidenceThreshold: 85,
        provider: 'ollama'
      };
    }
    
    if (!config.googleVision) {
      config.googleVision = {
        enabled: false,
        apiKey: ''
      };
    }
    
    // Initialize service with validated config
    aiAnalysisService = new AIAnalysisService(config);
    logger.info('✅ AI Analysis Service initialized successfully');
    return true;
    
  } catch (error) {
    logger.error('❌ Failed to initialize AI Analysis Service', { 
      error: error.message,
      stack: error.stack 
    });
    aiAnalysisService = null;
    return false;
  }
}

// Call initialization (non-blocking)
initializeAIServices().then(success => {
  if (!success) {
    logger.warn('⚠️ AI features will be unavailable');
  }
});

// Initialize XMP Generator (will be initialized after database)
let xmpGenerator;

// DEBUG: Test derivative detection on startup
logger.info('Running derivative detection test...');
fileManager.testDerivativeDetection();

/**
 * Initialize database on app startup
 */
function initializeDatabase() {
  const savedDbPath = configManager.getDatabasePath();
  
  if (savedDbPath && DatabaseService.databaseExists(savedDbPath)) {
    // Database exists at saved location
    const result = databaseService.initialize(savedDbPath);
    if (result.success) {
      logger.info('Database loaded from saved location', { dbPath: savedDbPath });
      
      // Initialize XMP Generator with database service
      try {
        xmpGenerator = new XMPGenerator(databaseService.db);
        logger.info('✅ XMP Generator initialized with database');
      } catch (error) {
        logger.error('Failed to initialize XMP Generator', { error: error.message });
      }
      
      return { initialized: true, dbPath: savedDbPath };
    }
  }
  
  // Database not found or failed to initialize
  logger.warn('Database not found or failed to initialize');
  return { initialized: false, needsSetup: true };
}

// IPC Handlers
ipcMain.handle('select-directory', async () => {
  try {
    logger.info('select-directory IPC called');
    
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Select Photo Directory'
    });
    
    logger.info('Dialog result:', { 
      canceled: result.canceled, 
      filePaths: result.filePaths 
    });
    
    if (result.canceled) {
      logger.info('User canceled directory selection');
      return { canceled: true };
    }
    
    if (!result.filePaths || result.filePaths.length === 0) {
      logger.error('No file paths returned from dialog');
      return { canceled: true };
    }
    
    const selectedPath = result.filePaths[0];
    logger.info('Directory selected:', { path: selectedPath });
    
    return { 
      canceled: false, 
      path: selectedPath
    };
  } catch (error) {
    logger.error('Error in select-directory handler:', { error: error.message });
    return { 
      canceled: true, 
      error: error.message 
    };
  }
});

ipcMain.handle('scan-directory', async (event, dirPath) => {
  try {
    logger.info('Scan directory requested', { dirPath });
    const results = await fileManager.scanDirectory(dirPath);
    const summary = fileManager.getScanSummary(results);
    
    // Convert Map to plain object for IPC serialization
    const derivativesObj = {};
    for (const [key, value] of results.derivatives) {
      derivativesObj[key] = value;
    }
    
    return { 
      success: true, 
      results: {
        baseImages: results.baseImages,
        derivatives: derivativesObj,
        stats: results.stats
      },
      summary
    };
  } catch (error) {
    logger.error('Scan directory failed', { dirPath, error: error.message });
    return { 
      success: false, 
      error: error.message 
    };
  }
});

ipcMain.handle('scan-directory-with-clustering', async (event, dirPath, timestampThreshold) => {
  try {
    logger.info('Scan with clustering requested', { dirPath, timestampThreshold });
    
    const results = await fileManager.scanDirectoryWithClustering(
      dirPath,
      timestampThreshold || 5
    );
    
    const summary = {
      ...fileManager.getScanSummary(results),
      totalClusters: results.clusterStats.totalClusters,
      bracketedClusters: results.clusterStats.bracketedClusters,
      singletonClusters: results.clusterStats.singletonClusters,
      averageClusterSize: results.clusterStats.averageClusterSize.toFixed(2)
    };
    
    // Convert Map to plain object for IPC serialization
    const derivativesObj = {};
    for (const [key, value] of results.derivatives) {
      derivativesObj[key] = value;
    }
    
    return { 
      success: true, 
      results: {
        baseImages: results.baseImages,
        derivatives: derivativesObj,
        stats: results.stats,
        clusters: results.clusters,
        clusterStats: results.clusterStats
      },
      summary
    };
  } catch (error) {
    logger.error('Scan with clustering failed', { dirPath, error: error.message });
    return { 
      success: false, 
      error: error.message 
    };
  }
});

// New: Scan specific files with clustering (for files-only drag & drop)
ipcMain.handle('scan-files-with-clustering', async (event, filePaths, timestampThreshold) => {
  try {
    logger.info('Scan files with clustering requested', { count: filePaths?.length || 0, timestampThreshold });
    const results = await fileManager.scanFilesWithClustering(filePaths || [], timestampThreshold || 5);
    const summary = fileManager.getScanSummary(results);
    return {
      success: true,
      results: {
        baseImages: results.baseImages,
        derivatives: Object.fromEntries(results.derivatives),
        stats: results.stats,
        clusters: results.clusters,
        clusterStats: results.clusterStats
      },
      summary
    };
  } catch (error) {
    logger.error('Scan files with clustering failed', { error: error.message });
    return { success: false, error: error.message };
  }
});

// Process Images IPC Handler - Phase 2 Processing Pipeline
console.log('=== REGISTERING process-images IPC HANDLER ===');
ipcMain.handle('process-images', async (event, scanResults, dirPath, skipClustering = false, clipValue = 95) => {
  try {
    // === CRITICAL DEBUG - RUN THIS FIRST ===
    console.log('=== PROCESS-IMAGES HANDLER STARTED ===');
    console.log('Arguments received:', { 
      scanResults: !!scanResults, 
      dirPath,
      skipClustering,
      clipValue
    });
    console.log('configManager exists:', typeof configManager);
    console.log('configManager.getAllSettings exists:', typeof configManager.getAllSettings);
    
    // Removed debug.txt writes - causes read-only errors in packaged app
    
    const testConfig = configManager.getAllSettings();
    console.log('testConfig:', JSON.stringify(testConfig, null, 2));
    console.log('testConfig.similarity:', testConfig?.similarity);
    
    // Removed debug.txt writes - causes read-only errors in packaged app
    
    console.log('=== END CRITICAL DEBUG ===');
    
    logger.info('Image processing started', { 
      totalClusters: scanResults.clusters?.length || 0,
      dirPath,
      skipClustering
    });

    const window = BrowserWindow.getAllWindows()[0];
    
    // Step 1: Extract metadata (GPS + timestamps) from all base images
    event.sender.send('progress', { 
      stage: 'metadata', 
      message: 'Extracting metadata from images...',
      percent: 0 
    });

    const baseImages = scanResults.clusters.flatMap(c => c.imagePaths);
    logger.info('Extracting metadata', { totalImages: baseImages.length });

    const metadataResults = [];
    for (let i = 0; i < baseImages.length; i++) {
      const imagePath = baseImages[i];
      
      try {
        const metadata = await exifExtractor.extractMetadata(imagePath);
        metadataResults.push({
          path: imagePath,
          ...metadata
        });

        event.sender.send('progress', { 
          stage: 'metadata', 
          message: `Processing ${path.basename(imagePath)}...`,
          percent: Math.round(((i + 1) / baseImages.length) * 30) // 0-30%
        });

      } catch (error) {
        logger.error('Metadata extraction failed', { imagePath, error: error.message });
      }
    }

    // Step 2: (DEPRECATED) Folder Keywords removed as per user request

    // ✅ CRITICAL DECISION POINT: Process differently based on skipClustering
    if (skipClustering) {
      // ========================================
      // SKIP CLUSTERING MODE - PROCESS ALL IMAGES IN EACH BRACKET GROUP
      // ========================================
      logger.info('⚡ SKIP CLUSTERING MODE - Processing all images in bracket groups');
      
      event.sender.send('progress', { 
        stage: 'thumbnails', 
        message: 'Creating thumbnails for all images...',
        percent: 35 
      });

      const bracketGroupResults = [];
      let totalImagesProcessed = 0;
      const totalImagesToProcess = baseImages.length;

      // Loop through each bracket group (cluster)
      for (let clusterIndex = 0; clusterIndex < scanResults.clusters.length; clusterIndex++) {
        const cluster = scanResults.clusters[clusterIndex];
        const representativePath = cluster.representative || cluster.representativePath;
        
        const processedImages = []; // Store all processed images in this bracket group
        
        // Process ALL images in this bracket group
        for (let imgIndex = 0; imgIndex < cluster.imagePaths.length; imgIndex++) {
          const imagePath = cluster.imagePaths[imgIndex];
          
          try {
            const result = await imageProcessor.processImage(imagePath);
            
            if (result.success) {
              const imageMetadata = metadataResults.find(m => m.path === imagePath);
              
              processedImages.push({
                path: imagePath,
                filename: path.basename(imagePath),
                previewPath: result.previewPath,
                hash: result.hash,
                timestamp: result.timestamp || imageMetadata?.timestamp,
                gps: imageMetadata?.gps || null,
                metadata: imageMetadata,
                isRepresentative: imagePath === representativePath
              });
            }

            totalImagesProcessed++;
            event.sender.send('progress', { 
              stage: 'thumbnails', 
              message: `Processing image ${totalImagesProcessed}/${totalImagesToProcess}...`,
              percent: 35 + Math.round((totalImagesProcessed / totalImagesToProcess) * 60) // 35-95%
            });

          } catch (error) {
            logger.error('Thumbnail creation failed', { imagePath, error: error.message });
          }
        }

        // Get derivatives for this cluster
        let derivatives = [];
        if (scanResults.derivatives) {
          const allClusterImages = cluster.imagePaths || [cluster.representative];
          allClusterImages.forEach(imagePath => {
            let imageDerivatives = [];
            if (scanResults.derivatives instanceof Map) {
              imageDerivatives = scanResults.derivatives.get(imagePath) || [];
            } else {
              imageDerivatives = scanResults.derivatives[imagePath] || [];
            }
            imageDerivatives.forEach(deriv => {
              if (!derivatives.includes(deriv)) {
                derivatives.push(deriv);
              }
            });
          });
        }

        // Add this bracket group to results (compatible structure)
        if (processedImages.length > 0) {
          bracketGroupResults.push({
            representative: path.basename(representativePath),
            representativePath: representativePath,
            representativeFilename: path.basename(representativePath),
            imageCount: cluster.imageCount,
            imagePaths: cluster.imagePaths, // ✅ Maintain compatibility
            processedImages: processedImages, // ✅ Per-image processed data
            derivatives: derivatives,
            isBracketed: cluster.isBracketed,
            keywords: [],
            timestamp: processedImages.find(img => img.isRepresentative)?.timestamp,
            gps: processedImages.find(img => img.isRepresentative)?.gps, // Representative GPS for compatibility
            processed: true,
            hash: processedImages.find(img => img.isRepresentative)?.hash,
            analysisCount: 0,
            skipClustering: true // ✅ Flag for frontend
          });
        }
      }

      logger.info('Skip clustering processing complete', { 
        bracketGroups: bracketGroupResults.length,
        totalImagesProcessed 
      });

      event.sender.send('progress', { 
        stage: 'complete', 
        message: 'Processing complete (clustering skipped)',
        percent: 100 
      });

      return {
        success: true,
        results: {
          clustersProcessed: bracketGroupResults.length,
          imagesProcessed: totalImagesProcessed,
          imagesFailed: 0,
          keywords: [],
          savedToDatabase: 0,
          similarPairs: 0
        },
        processedClusters: bracketGroupResults,
        similarityResults: [], // Empty - no similarity detection
        skipClustering: true,
        mode: 'bracket-groups'
      };
    }

    // ========================================
    // NORMAL CLUSTERING PATH - PROCESS ONLY REPRESENTATIVES
    // ========================================
    
    // Step 3: Process ONLY cluster representatives (not all images!)
    event.sender.send('progress', { 
      stage: 'processing', 
      message: 'Processing cluster representatives...',
      percent: 35 
    });

    const imageResults = [];
    
    // DEBUG: Log cluster structure to identify path issue
    logger.info('=== REPRESENTATIVE PATHS DEBUG ===');
    scanResults.clusters.forEach((cluster, idx) => {
      logger.info(`Cluster ${idx}:`, {
        representative: cluster.representative,
        representativePath: cluster.representativePath,
        type: typeof cluster.representative,
        isAbsolute: cluster.representative?.startsWith('/'),
        sampleImagePath: cluster.imagePaths?.[0],
        imageCount: cluster.imageCount
      });
    });
    logger.info('=== END DEBUG ===');
    
    // CRITICAL FIX: Only process representatives (ensure full paths)
    const representativesToProcess = scanResults.clusters.map(c => {
      const repPath = c.representative || c.representativePath;
      
      // CRITICAL: Verify this is an absolute path
      if (!repPath || !path.isAbsolute(repPath)) {
        logger.error('❌ Invalid representative path!', { 
          cluster: c,
          representative: c.representative,
          representativePath: c.representativePath
        });
        return null;
      }
      
      return repPath;
    }).filter(p => p !== null); // Remove nulls
    
    logger.info('🎯 Representatives to process:', {
      count: representativesToProcess.length,
      samplePaths: representativesToProcess.slice(0, 3)
    });

    for (let i = 0; i < representativesToProcess.length; i++) {
      const imagePath = representativesToProcess[i];
      
      // CRITICAL: Verify this is a full path
      if (!imagePath || !imagePath.startsWith('/')) {
        logger.error('Invalid path - not absolute!', { 
          imagePath,
          cluster: scanResults.clusters[i],
          clusterIndex: i
        });
        continue;
      }
      
      const metadata = metadataResults.find(m => m.path === imagePath);

      try {
        logger.debug('Processing representative', { 
          index: i + 1,
          total: representativesToProcess.length,
          path: imagePath,
          hasMetadata: !!metadata
        });
        
        const result = await imageProcessor.processImage(imagePath);
        
        // 🔥 DEBUG: Log EVERY result to see why success is false
        console.log('🔥 IMAGE PROCESSING RESULT:', {
          file: path.basename(imagePath),
          success: result.success,
          hasHash: !!result.hash,
          hasPreview: !!result.previewPath,
          error: result.error
        });
        
        // 🔍 HASH DEBUG - Critical debugging for similarity detection
        logger.info('🔍 HASH DEBUG', {
          file: path.basename(imagePath),
          hash: result.hash,
          hashLength: result.hash?.length,
          previewPath: result.previewPath,
          success: result.success
        });
        
        imageResults.push({
          path: imagePath,
          success: result.success,
          hash: result.hash,
          previewPath: result.previewPath,
          timestamp: metadata?.timestamp,
          gps: metadata?.gps,
          keywords: [],
          error: result.error
        });

      } catch (error) {
        logger.error('Image processing failed', { 
          imagePath, 
          error: error.message,
          stack: error.stack
        });
        
        imageResults.push({
          path: imagePath,
          success: false,
          error: error.message,
          timestamp: metadata?.timestamp,
          gps: metadata?.gps,
          keywords: []
        });
      }

      const progress = 35 + Math.round(((i + 1) / representativesToProcess.length) * 40);
      event.sender.send('progress', { 
        stage: 'processing', 
        message: `Processing ${i + 1} of ${representativesToProcess.length} representatives...`,
        percent: progress
      });
    }

    logger.info('Image processing complete', {
      total: imageResults.length,
      successful: imageResults.filter(r => r.success).length,
      failed: imageResults.filter(r => !r.success).length
    });

    // Step 4: Refine clusters using perceptual hashing
    event.sender.send('progress', { 
      stage: 'refining', 
      message: 'Refining image clusters...',
      percent: 75 
    });

    const refinedClusters = [];
    const successfulResults = imageResults.filter(r => r.success);
    
    if (successfulResults.length > 0) {
      // CRITICAL FIX: Build image objects with required hash data
      for (const cluster of scanResults.clusters) {
        const clusterImageData = cluster.imagePaths.map(imagePath => {
          const result = imageResults.find(r => r.path === imagePath && r.success);
          if (!result) return null;
          
          return {
            path: imagePath,
            hash: result.hash,
            timestamp: result.timestamp
          };
        }).filter(img => img !== null && img.hash); // Only include successfully processed images with hashes

        if (clusterImageData.length > 0) {
          try {
            const subGroups = await clusterRefiner.refineCluster(clusterImageData, 13);
            
            refinedClusters.push({
              originalCluster: cluster,
              subGroups: subGroups,
              wasRefined: subGroups.length > 1
            });
            
            logger.info('Cluster refined', {
              representative: path.basename(cluster.representative),
              originalSize: cluster.imageCount,
              subGroups: subGroups.length
            });
            
          } catch (error) {
            logger.error('Cluster refinement failed', { 
              cluster: cluster.representative,
              error: error.message 
            });
            
            // Fallback: Keep original cluster structure
            refinedClusters.push({
              originalCluster: cluster,
              subGroups: [{
                representative: cluster.representative,
                images: cluster.imagePaths,
                similarityScore: 0
              }],
              wasRefined: false,
              error: error.message
            });
          }
        }
      }
    }

    logger.info('Cluster refinement complete', {
      totalClusters: refinedClusters.length,
      refined: refinedClusters.filter(c => c.wasRefined).length
    });
    
    console.log('🔥 CLUSTER REFINEMENT COMPLETE - MOVING TO SIMILARITY DETECTION 🔥');
    console.log('🔥 ABOUT TO START SIMILARITY DETECTION SECTION 🔥');
    // Removed debug.txt writes - causes read-only errors in packaged app

    // Step 5: Detect similarity between representatives using CLIP
    console.log('🔥🔥🔥 STEP 5: REACHING SIMILARITY DETECTION SECTION 🔥🔥🔥');
    // Removed debug.txt writes - causes read-only errors in packaged app

    let similarityResults = [];
    const config = configManager.getAllSettings();

    // ✅ FIX: Check cluster count, not successfulResults
    if (config?.similarity?.enabled && scanResults.clusters.length >= 2) {
      console.log('🔥🔥🔥 CLIP SIMILARITY DETECTION STARTING 🔥🔥🔥');
      // Removed debug.txt writes - causes read-only errors in packaged app
      
      // ✅ Check if CLIP service is ready - wait up to 5 minutes if not ready yet
      // On first run, CLIP service needs to create venv, install deps, and download model (~890MB)
      let clipServiceReady = false;
      const maxWaitTime = 300000; // 5 minutes for first-time setup
      const startWaitTime = Date.now();
      let clipStartError = null;
      
      logger.info('Checking CLIP service availability...');
      
      // First, make sure CLIP service is starting if it hasn't already
      if (!clipServiceManager.process && !clipServiceManager.isStarting) {
        logger.info('CLIP service not started yet, starting now...');
        event.sender.send('progress', { 
          stage: 'similarity', 
          message: 'Starting CLIP service...',
          percent: 78 
        });
        
        // Start CLIP service - catch errors but don't await
        clipServiceManager.start().catch(err => {
          logger.error('Failed to start CLIP service', { error: err.message });
          clipStartError = err;
        });
      }
      
      // Wait for CLIP service to be ready with timeout and progress updates
      while (!clipServiceReady && (Date.now() - startWaitTime) < maxWaitTime) {
        try {
          clipServiceReady = await Promise.race([
            clipServiceManager.checkHealth(),
            new Promise((resolve) => setTimeout(() => resolve(false), 3000)) // 3 second timeout for health check
          ]);
          
          if (!clipServiceReady) {
            const elapsedSeconds = Math.round((Date.now() - startWaitTime) / 1000);
            const isStarting = clipServiceManager.isStarting;
            const hasProcess = !!clipServiceManager.process;
            
            // Check if there was an error starting
            if (clipStartError && !hasProcess && !isStarting) {
              logger.error('CLIP service failed to start', { error: clipStartError.message });
              throw new Error(`CLIP service failed to start: ${clipStartError.message}`);
            }
            
            logger.info('CLIP service not ready yet, waiting...', { 
              elapsed: elapsedSeconds + 's',
              isStarting: isStarting,
              hasProcess: hasProcess
            });
            
            // Update progress with more informative message and incremental percent
            let progressMessage = 'Waiting for CLIP service...';
            // Increment progress slightly (78% to 79%) to show activity
            const progressPercent = Math.min(78 + Math.floor(elapsedSeconds / 10), 79);
            
            if (isStarting) {
              progressMessage = `CLIP service is starting... (${elapsedSeconds}s elapsed, this may take several minutes on first run)`;
            } else if (!hasProcess) {
              progressMessage = 'CLIP service not running, attempting to start...';
            } else {
              progressMessage = `Waiting for CLIP service to be ready... (${elapsedSeconds}s)`;
            }
            
            event.sender.send('progress', { 
              stage: 'similarity', 
              message: progressMessage,
              percent: progressPercent
            });
            
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between checks
          }
        } catch (error) {
          logger.error('Error checking CLIP service health', { error: error.message });
          // Don't throw immediately - give it a few more tries
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }
      
      if (!clipServiceReady) {
        const elapsedMinutes = Math.round((Date.now() - startWaitTime) / 60000);
        logger.error(`CLIP service not ready after waiting ${elapsedMinutes} minutes`);
        throw new Error(`CLIP similarity service is not ready after ${elapsedMinutes} minutes. On first run, this may take 5-10 minutes to set up (creating virtual environment, installing dependencies, downloading model). Please check the logs and try again.`);
      }
      
      logger.info('✅ CLIP service is ready');
      
      // ✅ Use user-provided CLIP value instead of config threshold
      const clipThreshold = clipValue || config?.similarity?.hammingThreshold || 95;
      logger.info('Starting CLIP similarity detection', {
        representatives: scanResults.clusters.length,
        threshold: clipThreshold
      });
      
      event.sender.send('progress', { 
        stage: 'similarity', 
        message: `Analyzing ${scanResults.clusters.length} representatives...`,
        percent: 78 
      });
      
      // ✅ Store original threshold for restoration
      const originalThreshold = similarityDetector.threshold;
      
      try {
        // ✅ FIX 1: ONLY process cluster representatives (13), not all images (52)
        console.log('🔥 GENERATING PREVIEWS FOR REPRESENTATIVES ONLY...');
        const previewToOriginal = new Map(); // preview path -> original path
        const originalToPreview = new Map(); // original path -> preview path
        
        // Loop through CLUSTERS, not successfulResults!
        for (const cluster of scanResults.clusters) {
          const representativePath = cluster.representative || cluster.representativePath;
          
          if (!representativePath) {
            logger.warn('Cluster missing representative path', { cluster });
            continue;
          }
          
          try {
            // Generate fresh preview for CLIP
            const previewPath = await imageProcessor.extractPreview(representativePath);
            previewToOriginal.set(previewPath, representativePath);
            originalToPreview.set(representativePath, previewPath);
            
            console.log('✅ Representative preview:', path.basename(representativePath));
          } catch (error) {
            logger.error('Preview generation failed for representative', { 
              representativePath, 
              error: error.message 
            });
          }
        }
        
        console.log(`🎯 Generated ${previewToOriginal.size} previews (expected ${scanResults.clusters.length})`);
        
        if (previewToOriginal.size < 2) {
          throw new Error(`Only ${previewToOriginal.size} previews generated, need at least 2`);
        }
        
        event.sender.send('progress', { 
          stage: 'similarity', 
          message: 'Running CLIP analysis...',
          percent: 80 
        });
        
        // Send preview JPGs to CLIP
        const previewPaths = Array.from(previewToOriginal.keys());

        console.log('🔍 ===== CLIP INPUT DEBUG =====');
        console.log(`📊 Sending ${previewPaths.length} images to CLIP`);
        for (let i = 0; i < previewPaths.length; i++) {
          const previewPath = previewPaths[i];
          const originalPath = previewToOriginal.get(previewPath);
          console.log(`  ${i + 1}. ${path.basename(originalPath)}`);
        }
        console.log('🔍 ===========================\n');

        // ✅ Temporarily override threshold with user-provided CLIP value
        similarityDetector.threshold = clipThreshold;
        console.log(`🎯 Using CLIP threshold: ${clipThreshold}% (config default: ${config?.similarity?.hammingThreshold || 80}%)`);
        
        let clipResults;
        try {
          clipResults = await similarityDetector.findSimilarRepresentatives(previewPaths);

        console.log('🔍 ===== CLIP RETURNED =====');
        console.log(`📊 CLIP found ${clipResults.length} pairs`);
        clipResults.forEach((pair, idx) => {
          const orig1 = previewToOriginal.get(pair.rep1);
          const orig2 = previewToOriginal.get(pair.rep2);
          console.log(`  ${idx + 1}. ${path.basename(orig1)} ↔ ${path.basename(orig2)} (${pair.similarityPercent}%)`);
        });
        console.log('🔍 ==========================\n');
        
        // ✅ FIX 2: Map preview paths back to original image paths
        similarityResults = clipResults.map(pair => {
          const original1 = previewToOriginal.get(pair.rep1);
          const original2 = previewToOriginal.get(pair.rep2);
          
          if (!original1 || !original2) {
            logger.warn('Could not map preview to original', { 
              preview1: pair.rep1, 
              preview2: pair.rep2 
            });
            return null;
          }
          
          return {
            rep1: original1,                          // ✅ Original image path
            rep2: original2,                          // ✅ Original image path
            similarity: pair.similarity,
            similarityPercent: pair.similarityPercent,
            fileName1: path.basename(original1),      // ✅ Original filename
            fileName2: path.basename(original2)       // ✅ Original filename
          };
        }).filter(pair => pair !== null); // Remove any failed mappings
        
        console.log(`✅ Mapped ${similarityResults.length} similar pairs to original filenames`);

        // 🔍 DEBUG: Log final similarity results being returned
        console.log('🔍 ===== FINAL SIMILARITY RESULTS BEING RETURNED =====');
        console.log(`📊 Total pairs: ${similarityResults.length}`);
        if (similarityResults.length > 0) {
          console.log('📋 First 3 pairs:');
          similarityResults.slice(0, 3).forEach((pair, idx) => {
            console.log(`  ${idx + 1}. ${pair.fileName1} ↔ ${pair.fileName2} (${pair.similarityPercent}%)`);
            console.log(`     rep1: ${pair.rep1}`);
            console.log(`     rep2: ${pair.rep2}`);
          });
        }
        console.log('🔍 ================================================\n');
        
        // Log the results for debugging
        similarityResults.forEach(pair => {
          logger.info('Similar representatives found', {
            file1: pair.fileName1,
            file2: pair.fileName2,
            similarity: `${pair.similarityPercent}%`
          });
        });
        
        logger.info('CLIP similarity detection complete', {
          representativesProcessed: previewToOriginal.size,
          comparisons: (previewToOriginal.size * (previewToOriginal.size - 1)) / 2,
          similarPairs: similarityResults.length,
          threshold: clipThreshold + '%'
        });
        
        event.sender.send('progress', { 
          stage: 'similarity', 
          message: `Found ${similarityResults.length} similar pairs`,
          percent: 85 
        });
        
        } finally {
          // ✅ Restore original threshold
          similarityDetector.threshold = originalThreshold;
        }
        
      } catch (error) {
        // ✅ Restore original threshold even on error
        similarityDetector.threshold = originalThreshold;
        console.error('❌ CLIP SIMILARITY FAILED:', error.message);
        console.error('Stack:', error.stack);
        
        logger.error('CLIP similarity detection failed', {
          error: error.message,
          stack: error.stack
        });
        
        event.sender.send('progress', { 
          stage: 'similarity', 
          message: 'Similarity detection failed - ' + error.message,
          percent: 85 
        });
        
        similarityResults = [];
      }
    } else {
      const skipReason = !config?.similarity?.enabled 
        ? 'Similarity detection disabled in config'
        : `Insufficient clusters (${scanResults.clusters?.length || 0} available, need 2+)`;
      
      console.log('❌ SIMILARITY DETECTION SKIPPED:', skipReason);
      // Removed debug.txt writes - causes read-only errors in packaged app
      
      logger.info('Similarity detection skipped', { reason: skipReason });
    }

    // Step 6: Save to database
    event.sender.send('progress', { 
      stage: 'saving', 
      message: 'Saving results to database...',
      percent: 90 
    });

    const saveResult = databaseService.saveProcessingResults(imageResults);
    logger.info('Processing results saved', saveResult);

    // Complete (MOVED TO THE END)
    event.sender.send('progress', { 
      stage: 'complete', 
      message: 'Processing complete!',
      percent: 100 
    });

    // ============================================================================
    // 🔍 BACKEND DIAGNOSTIC - Check scanResults.derivatives Map
    // ============================================================================
    console.log('\n🔍 ========== BACKEND: scanResults.derivatives CHECK ==========');
    console.log('scanResults.derivatives type:', scanResults.derivatives instanceof Map ? 'Map' : typeof scanResults.derivatives);

    if (scanResults.derivatives instanceof Map) {
      console.log('Map size:', scanResults.derivatives.size);
      console.log('Map keys:');
      for (const [key, value] of scanResults.derivatives.entries()) {
        console.log(`  "${key}": ${value.length} derivatives`);
        value.forEach(d => console.log(`    - ${path.basename(d)}`));
      }
    } else if (scanResults.derivatives) {
      console.log('Object keys:', Object.keys(scanResults.derivatives));
      Object.entries(scanResults.derivatives).forEach(([key, value]) => {
        console.log(`  "${key}": ${value.length} derivatives`);
      });
    }

    console.log('\nCluster representatives:');
    scanResults.clusters.forEach((cluster, idx) => {
      console.log(`  [${idx}] "${cluster.representative}"`);
    });

    console.log('🔍 ==========================================\n');
    // ============================================================================
    
    // ============================================================================
    // 🔍 MISSING FILE INVESTIGATION - Bug #2 Diagnostic
    // ============================================================================
    console.log('\n🔍 ===== MISSING FILE INVESTIGATION =====');
    console.log('Looking for _GP_0831.CR2 and _GP_0831_adj.tif...\n');

    // Check if base image exists
    const gp831Base = scanResults.baseImages?.find(img => 
      path.basename(img).includes('_GP_0831')
    );
    console.log(`_GP_0831.CR2 base image: ${gp831Base ? '✅ FOUND' : '❌ NOT FOUND'}`);
    if (gp831Base) {
      console.log(`  Path: ${gp831Base}`);
      
      // Check which cluster it's in
      const gp831Cluster = scanResults.clusters.find(c => 
        c.imagePaths?.includes(gp831Base)
      );
      if (gp831Cluster) {
        console.log(`  In cluster: ${path.basename(gp831Cluster.representative)}`);
        console.log(`  Cluster images: ${gp831Cluster.imagePaths.map(p => path.basename(p)).join(', ')}`);
      } else {
        console.log(`  ❌ NOT in any cluster!`);
      }
    }

    // Check if derivative exists in scan
    let gp831Deriv = null;
    if (scanResults.derivatives) {
      // FIX: Check if derivatives is a Map or plain object
      if (scanResults.derivatives instanceof Map) {
        // It's a Map - use .entries()
        for (const [base, derivs] of scanResults.derivatives.entries()) {
          const found = derivs.find(d => path.basename(d).includes('_GP_0831'));
          if (found) {
            gp831Deriv = { base, derivative: found };
            break;
          }
        }
      } else {
        // It's a plain object - use Object.entries()
        for (const [base, derivs] of Object.entries(scanResults.derivatives)) {
          const found = derivs.find(d => path.basename(d).includes('_GP_0831'));
          if (found) {
            gp831Deriv = { base, derivative: found };
            break;
          }
        }
      }
    }

    console.log(`_GP_0831_adj.tif derivative: ${gp831Deriv ? '✅ FOUND' : '❌ NOT FOUND'}`);
    if (gp831Deriv) {
      console.log(`  Linked to base: ${path.basename(gp831Deriv.base)}`);
      console.log(`  Derivative path: ${gp831Deriv.derivative}`);
    }
    
    // List ALL derivatives found for reference
    console.log('\n📋 All derivatives found in scan:');
    if (scanResults.derivatives instanceof Map) {
      for (const [base, derivs] of scanResults.derivatives.entries()) {
        console.log(`  ${path.basename(base)}: ${derivs.length} derivative(s)`);
        derivs.forEach(d => console.log(`    - ${path.basename(d)}`));
      }
    } else if (scanResults.derivatives) {
      // Plain object
      for (const [base, derivs] of Object.entries(scanResults.derivatives)) {
        console.log(`  ${path.basename(base)}: ${derivs.length} derivative(s)`);
        derivs.forEach(d => console.log(`    - ${path.basename(d)}`));
      }
    }
    console.log('🔍 =====================================\n');
    // ============================================================================

    // Build cluster results for UI
    const processedClusters = scanResults.clusters.map(cluster => {
      const repResult = imageResults.find(r => r.path === cluster.representative);
      const clusterKW = { all: [] };
      
      // ✅ FIX: Get derivatives from ALL images in the cluster, not just representative
      // Problem: Derivatives are keyed by base image, but representative can be any bracketed image
      // Solution: Check all images in cluster.imagePaths for derivatives
      let derivatives = [];
      if (scanResults.derivatives) {
        // Check all images in the cluster for derivatives
        const allClusterImages = cluster.imagePaths || [cluster.representative];
        
        allClusterImages.forEach(imagePath => {
          let imageDerivatives = [];
          if (scanResults.derivatives instanceof Map) {
            imageDerivatives = scanResults.derivatives.get(imagePath) || [];
          } else {
            imageDerivatives = scanResults.derivatives[imagePath] || [];
          }
          
          // Add to derivatives array (avoid duplicates)
          imageDerivatives.forEach(deriv => {
            if (!derivatives.includes(deriv)) {
              derivatives.push(deriv);
            }
          });
        });
      }
      
      return {
        representative: path.basename(cluster.representative),
        representativePath: cluster.representative,
        representativeFilename: path.basename(cluster.representative),
        imageCount: cluster.imageCount,
        imagePaths: cluster.imagePaths,
        derivatives: derivatives,  // ✅ Now includes ALL derivatives from all cluster images
        isBracketed: cluster.isBracketed,
        keywords: clusterKW.all, // ✅ CORRECT - uses cluster-specific keywords
        timestamp: repResult?.timestamp,
        gps: repResult?.gps,
        processed: repResult?.success || false,
        hash: repResult?.hash,
        analysisCount: 0 // Will be updated in Phase 3
      };
    });

    const allKeywords = [];
    
    return { 
      success: true,
      results: {
        clustersProcessed: representativesToProcess.length,
        imagesProcessed: imageResults.filter(r => r.success).length,
        imagesFailed: imageResults.filter(r => !r.success).length,
        keywords: [], // All unique keywords across all clusters
        savedToDatabase: saveResult.saved || 0,
        similarPairs: similarityResults.length // NEW
      },
      processedClusters, // Return cluster data, not individual images
      similarityResults // NEW: Pass similarity data to UI
    };

  } catch (error) {
    console.error('=== PROCESS-IMAGES HANDLER ERROR ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('=== END ERROR ===');
    
    logger.error('Image processing failed', { error: error.message });
    event.sender.send('progress', { 
      stage: 'error', 
      message: `Error: ${error.message}`,
      percent: 0 
    });
    return { 
      success: false, 
      error: error.message 
    };
  }
});

// Database IPC Handlers
ipcMain.handle('get-database-path', async () => {
  return configManager.getDatabasePath();
});

ipcMain.handle('select-database-location', async () => {
  const result = await dialog.showSaveDialog({
    title: 'Select Database Location',
    defaultPath: 'lightroom-metadata.db',
    filters: [
      { name: 'Database Files', extensions: ['db'] }
    ]
  });
  
  if (result.canceled) {
    return { canceled: true };
  }
  
  return { 
    canceled: false, 
    path: result.filePath 
  };
});

ipcMain.handle('set-database-path', async (event, dbPath) => {
  try {
    // Initialize database at new location
    const result = databaseService.initialize(dbPath);
    
    if (result.success) {
      // Save to config
      configManager.setDatabasePath(dbPath);
      
      // Initialize XMP Generator with new database
      try {
        xmpGenerator = new XMPGenerator(databaseService.db);
        logger.info('✅ XMP Generator initialized with new database');
      } catch (error) {
        logger.error('Failed to initialize XMP Generator', { error: error.message });
      }
      
      return { success: true, dbPath };
    }
    
    return { success: false, error: result.error };
    
  } catch (error) {
    logger.error('Failed to set database path', { dbPath, error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-database-stats', async () => {
  try {
    const stats = databaseService.getStats();
    const fileSize = databaseService.getFileSize();
    
    return {
      success: true,
      stats,
      fileSize: databaseService.formatFileSize(fileSize),
      dbPath: databaseService.dbPath
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('clear-database', async () => {
  try {
    const result = databaseService.clearAllRecords();
    return result;
  } catch (error) {
    logger.error('Failed to clear database', { error: error.message });
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-all-settings', async () => {
  return configManager.getAllSettings();
});

ipcMain.handle('get-processed-images', async () => {
  try {
    const result = databaseService.getAllProcessedImages();
    return result;
  } catch (error) {
    logger.error('Failed to get processed images', { error: error.message });
    return { success: false, error: error.message, images: [], totalCount: 0 };
  }
});

// Thumbnail retrieval IPC handler
ipcMain.handle('get-preview-image', async (event, imagePath) => {
  try {
    console.log('📸 Thumbnail request received:', imagePath); // ADD
    
    // Get the preview path from the image processor
    const hash = require('crypto').createHash('md5').update(imagePath).digest('hex');
    const previewPath = path.join(imageProcessor.tempDir, `${hash}.jpg`);
    
    console.log('📁 Looking for preview at:', previewPath); // ADD
    console.log('📁 Temp dir contents:', await fs.promises.readdir(imageProcessor.tempDir)); // ADD
    
    // Check if preview exists
    try {
      await fs.promises.access(previewPath);
      console.log('✅ Preview file exists'); // ADD
      // Read file as base64
      const imageBuffer = await fs.promises.readFile(previewPath);
      const base64Image = imageBuffer.toString('base64');
      return { 
        success: true, 
        dataUrl: `data:image/jpeg;base64,${base64Image}` 
      };
    } catch (error) {
      console.error('❌ Preview not found:', previewPath); // ADD
      console.error('❌ Error:', error.message); // ADD
      logger.warn('Preview not found in cache', { imagePath, previewPath });
      return { success: false, error: 'Preview not found' };
    }
  } catch (error) {
    console.error('💥 Failed to get preview:', error); // ADD
    logger.error('Failed to get preview image', { imagePath, error: error.message });
    return { success: false, error: error.message };
  }
});

// File system helpers for drag & drop
ipcMain.handle('is-directory', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return stats.isDirectory();
  } catch (error) {
    logger.error('Error checking if path is directory', { filePath, error: error.message });
    return false;
  }
});

ipcMain.handle('get-parent-dir', async (event, filePath) => {
  return path.dirname(filePath);
});

ipcMain.handle('check-database-status', async () => {
  const dbPath = configManager.getDatabasePath();
  
  if (!dbPath) {
    return { exists: false, needsSetup: true };
  }
  
  const exists = DatabaseService.databaseExists(dbPath);
  return { 
    exists, 
    needsSetup: !exists, 
    dbPath: exists ? dbPath : null 
  };
});

// CLIP service status check
ipcMain.handle('check-clip-service', async () => {
  try {
    const isHealthy = await clipServiceManager.checkHealth();
    return { 
      running: isHealthy, 
      ready: clipServiceManager.isReady 
    };
  } catch (error) {
    return { 
      running: false, 
      ready: false, 
      error: error.message 
    };
  }
});

// Restart CLIP service
ipcMain.handle('restart-clip-service', async () => {
  try {
    await clipServiceManager.restart();
    return { success: true };
  } catch (error) {
    logger.error('Failed to restart CLIP service', { error: error.message });
    return { success: false, error: error.message };
  }
});

// ============================================
// AI Settings Handlers
// ============================================

// Save AI settings
ipcMain.handle('save-ai-settings', async (event, settings) => {
  try {
    logger.info('Saving AI settings', {
      hasGoogleVisionKey: !!settings.googleVisionApiKey,
      hasAnchorContext: !!settings.anchorContext
    });
    
    if (settings.googleVisionApiKey) {
      const googleVision = configManager.get('googleVision') || {};
      googleVision.apiKey = settings.googleVisionApiKey;
      configManager.set('googleVision', googleVision);
    }

    // Save enabled Gemini models list
    if (settings.enabledGeminiModels !== undefined) {
      const aiAnalysis = configManager.get('aiAnalysis') || {};
      aiAnalysis.enabledGeminiModels = settings.enabledGeminiModels;
      configManager.set('aiAnalysis', aiAnalysis);
    }

    // Save active Gemini model
    if (settings.activeGeminiModel !== undefined) {
      const aiAnalysis = configManager.get('aiAnalysis') || {};
      aiAnalysis.activeGeminiModel = settings.activeGeminiModel;
      configManager.set('aiAnalysis', aiAnalysis);
    }

    // Save anchor context under aiAnalysis
    if (settings.anchorContext !== undefined) {
      const aiAnalysis = configManager.get('aiAnalysis') || {};
      aiAnalysis.anchorContext = settings.anchorContext;
      configManager.set('aiAnalysis', aiAnalysis);
    }

    // Save Gemini temperature under aiAnalysis
    if (settings.geminiTemperature !== undefined) {
      const aiAnalysis = configManager.get('aiAnalysis') || {};
      aiAnalysis.geminiTemperature = settings.geminiTemperature;
      configManager.set('aiAnalysis', aiAnalysis);
    }
    
    logger.info('AI settings saved successfully');
    
    // Reinitialize AI Analysis Service with new settings
    await initializeAIServices();
    
    return { success: true };
    
  } catch (error) {
    logger.error('Failed to save AI settings', { error: error.message });
    return { success: false, error: error.message };
  }
});

// List Google AI Studio (Gemini) models that support generateContent
ipcMain.handle('list-ai-studio-models', async (event, apiKey) => {
  try {
    const axios = require('axios');
    const base = 'https://generativelanguage.googleapis.com';
    const tryList = async (version) => (await axios.get(`${base}/${version}/models?key=${apiKey}`, { timeout: 15000 })).data?.models || [];
    let models = [];
    try {
      models = await tryList('v1beta');
    } catch {
      models = await tryList('v1');
    }
    const supportsGen = (m) => (m.supportedGenerationMethods || []).includes('generateContent');
    const names = models.filter(supportsGen).map(m => m.name).filter(Boolean);
    names.sort((a,b) => {
      const getVersion = (name) => {
        const m = name.match(/gemini-(\d+\.\d+)/);
        return m ? parseFloat(m[1]) : 0;
      };
      const va = getVersion(a);
      const vb = getVersion(b);
      if (va !== vb) return vb - va; // higher version first
      
      const rankA = a.includes('pro') ? 3 : a.includes('flash-lite') ? 1 : a.includes('flash') ? 2 : 0;
      const rankB = b.includes('pro') ? 3 : b.includes('flash-lite') ? 1 : b.includes('flash') ? 2 : 0;
      if (rankA !== rankB) return rankB - rankA;
      
      return a.localeCompare(b);
    });
    return { success: true, models: names };
  } catch (error) {
    return { success: false, error: error.response?.data?.error?.message || error.message };
  }
});

// Test Google Vision API
ipcMain.handle('test-google-vision-api', async (event, apiKey) => {
  try {
    const axios = require('axios');
    
    logger.info('Testing Google Vision API connection', { hasApiKey: !!apiKey });
    
    // Simple API quota/authentication test
    const response = await axios.get(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      { timeout: 5000 }
    );
    
    // If we get a 405 (Method Not Allowed), the API key is valid but we used wrong method
    // This is actually what we want - it means the key works!
    logger.info('Google Vision API test: Key is valid');
    return { success: true };
    
  } catch (error) {
    logger.error('Google Vision API test failed', { 
      status: error.response?.status,
      error: error.message 
    });
    
    // 405 = Method Not Allowed (key is valid, just wrong HTTP method)
    // 400 = Bad Request (key is valid, just bad request format)
    if (error.response?.status === 405 || error.response?.status === 400) {
      return { success: true, message: 'API key is valid' };
    }
    
    // 403 = Forbidden (invalid key or API not enabled)
    // 401 = Unauthorized (invalid key)
    if (error.response?.status === 403 || error.response?.status === 401) {
      return { 
        success: false, 
        error: 'Invalid API key or Vision API not enabled in Google Cloud Console' 
      };
    }
    
    return { 
      success: false, 
      error: error.response?.data?.error?.message || error.message 
    };
  }
});

// Test Google AI Studio (Gemini) API
ipcMain.handle('test-ai-studio', async (event, apiKey) => {
  try {
    const axios = require('axios');
    logger.info('Testing Google AI Studio (Gemini) API connection', { hasApiKey: !!apiKey });
    const base = 'https://generativelanguage.googleapis.com';
    const listModels = async (version) => {
      return await axios.get(`${base}/${version}/models?key=${apiKey}`, { timeout: 7000 });
    };
    // 1) List models (try v1beta then v1)
    let listResp;
    try {
      listResp = await listModels('v1beta');
    } catch (e1) {
      logger.warn('v1beta list models failed, retrying v1', { error: e1.message });
      listResp = await listModels('v1');
    }
    const models = listResp.data?.models || [];
    const pickModel = () => {
      // Prefer highest version models first, then Pro > Flash > Flash-lite
      const supportsGen = (m) => (m.supportedGenerationMethods || []).includes('generateContent');
      const validModels = models.filter(supportsGen);
      if (validModels.length === 0) return null;
      
      validModels.sort((a,b) => {
        const getVersion = (name) => {
          const m = name.match(/gemini-(\d+\.\d+)/);
          return m ? parseFloat(m[1]) : 0;
        };
        const va = getVersion(a.name);
        const vb = getVersion(b.name);
        if (va !== vb) return vb - va; // higher version first
        
        const rankA = a.name.includes('pro') ? 3 : a.name.includes('flash-lite') ? 1 : a.name.includes('flash') ? 2 : 0;
        const rankB = b.name.includes('pro') ? 3 : b.name.includes('flash-lite') ? 1 : b.name.includes('flash') ? 2 : 0;
        if (rankA !== rankB) return rankB - rankA;
        
        return a.name.localeCompare(b.name);
      });
      return validModels[0];
    };
    const model = pickModel();
    if (!model) {
      return { success: false, error: 'No Gemini model with generateContent available to this key/project' };
    }

    // 2) Simple text ping against selected model
    // 2) Simple text ping against selected model (try v1beta then v1)
    const payload = { contents: [ { parts: [ { text: 'ping' } ] } ] };
    let response;
    try {
      response = await axios.post(`${base}/v1beta/${model.name}:generateContent?key=${apiKey}`, payload, { timeout: 15000 });
    } catch (e2) {
      logger.warn('v1beta generateContent failed, retrying v1', { error: e2.message, model: model.name });
      response = await axios.post(`${base}/v1/${model.name}:generateContent?key=${apiKey}`, payload, { timeout: 15000 });
    }
    if (response.status === 200) {
      logger.info('AI Studio test: Key is valid', { model: model.name });
      return { success: true, model: model.name };
    }
    return { success: false, error: `Unexpected status: ${response.status}`, model: model.name };
  } catch (error) {
    logger.error('AI Studio API test failed', { 
      status: error.response?.status,
      error: error.message,
      code: error.code
    });
    const status = error.response?.status;
    if (status === 400) {
      // Bad request still proves the key is valid and service reachable
      return { success: true, message: 'API reachable (400 Bad Request indicates key accepted)' };
    }
    if (status === 401 || status === 403) {
      return { success: false, error: 'Invalid AI Studio key or API not enabled' };
    }
    // Network timeouts / DNS / firewall will surface here
    const detail = error.response?.data?.error?.message || `${error.code || 'NETWORK'}: ${error.message}`;
    return { success: false, error: detail };
  }
});

// ============================================
// Personal Data IPC Handlers
// ============================================

// Get personal data
ipcMain.handle('get-personal-data', async () => {
  try {
    const data = databaseService.db.prepare('SELECT * FROM personal_data WHERE id = 1').get();
    
    logger.info('Personal data retrieved', { 
      hasData: !!data,
      creator: data?.creatorName 
    });
    
    return { success: true, data };
  } catch (error) {
    logger.error('Failed to get personal data', { error: error.message });
    return { success: false, error: error.message };
  }
});

// Save personal data
ipcMain.handle('save-personal-data', async (event, data) => {
  try {
    logger.info('Saving personal data', { creator: data.creatorName });
    
    const stmt = databaseService.db.prepare(`
      INSERT OR REPLACE INTO personal_data (
        id, creatorName, jobTitle, address, city, state, postalCode, 
        country, phone, email, website, copyrightStatus, copyrightNotice, rightsUsageTerms
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      data.creatorName,
      data.jobTitle || null,
      data.address || null,
      data.city || null,
      data.state || null,
      data.postalCode || null,
      data.country || null,
      data.phone || null,
      data.email,
      data.website || null,
      data.copyrightStatus || 'copyrighted',
      data.copyrightNotice,
      data.rightsUsageTerms || null
    );
    
    logger.info('Personal data saved successfully');
    
    return { success: true };
  } catch (error) {
    logger.error('Failed to save personal data', { error: error.message });
    return { success: false, error: error.message };
  }
});

// ============================================
// AI Analysis IPC Handlers
// ============================================

ipcMain.handle('analyze-cluster-with-ai', async (event, clusterGroup, customPrompt) => {
  try {
    logger.info('Starting AI analysis', { 
      representative: clusterGroup.mainRep?.representativeFilename,
      hasCustomPrompt: !!customPrompt
    });
    
    // Check if service is initialized
    if (!aiAnalysisService) {
      logger.error('AI Analysis Service not initialized');
      
      // Try to initialize it now
      const config = configManager.getAllSettings();
      try {
        aiAnalysisService = new AIAnalysisService(config);
        logger.info('✅ AI Analysis Service initialized on-demand');
      } catch (initError) {
        logger.error('Failed to initialize AI service on-demand', { error: initError.message });
        return {
          success: false,
          error: 'AI Analysis Service failed to initialize. Check that:\n' +
                 '1. Ollama is running (ollama serve)\n' +
                 '2. Vision model is installed (ollama pull qwen2.5vl:latest)\n' +
                 '3. Config file has correct settings\n\n' +
                 `Error: ${initError.message}`
        };
      }
    }
    
    // Use Google AI Studio (Gemini) exclusively
    const config = configManager.getAllSettings();
    const selectedProvider = 'google';
    
    // ✅ Update AI service config to ensure it has latest settings
    if (aiAnalysisService && config) {
      aiAnalysisService.config = config;
      // Update Gemini service config
      if (aiAnalysisService.geminiService) {
        aiAnalysisService.geminiService.updateConfig(config);
      }
    }
    
    // ✅ Ensure GPS is properly extracted from clusterGroup (including bracket images)
    // If mainRep doesn't have GPS, check processedImages for GPS
    if (clusterGroup.mainRep && !clusterGroup.mainRep.gps) {
      if (clusterGroup.processedImages && Array.isArray(clusterGroup.processedImages)) {
        for (const img of clusterGroup.processedImages) {
          if (img.gps && img.gps.latitude && img.gps.longitude) {
            // Set GPS on mainRep so it's available for analysis
            clusterGroup.mainRep.gps = img.gps;
            logger.info('✅ GPS found in processedImages, copied to mainRep', {
              representative: clusterGroup.mainRep.representativeFilename,
              gps: img.gps
            });
            break; // Use first GPS found
          }
        }
      }
    }
    
    logger.info('AI Analysis provider check', {
      hasActiveGeminiModel: !!config.aiAnalysis?.activeGeminiModel,
      activeGeminiModel: config.aiAnalysis?.activeGeminiModel,
      selectedProvider,
      geminiConfigured: aiAnalysisService?.geminiService?.isConfigured(),
      hasGPS: !!clusterGroup.mainRep?.gps,
      gpsFromProcessedImages: clusterGroup.processedImages?.some(img => img.gps)
    });
    
    // Send progress updates
    event.sender.send('progress-update', {
      stage: 'ai-analysis',
      message: customPrompt 
        ? 'Analyzing with custom prompt...' 
        : 'Analyzing with default prompt...',
      percent: 10
    });
    
    // Perform analysis with custom prompt if provided
    const analysisResult = await aiAnalysisService.analyzeCluster(
      clusterGroup,
      {},
      'google', // Use exclusively Gemini provider
      customPrompt
    );
    
    event.sender.send('progress-update', {
      stage: 'ai-analysis',
      message: 'Analysis complete!',
      percent: 100
    });
    
    logger.info('AI analysis complete', {
      confidence: analysisResult.metadata.confidence,
      provider: analysisResult.metadata.provider,
      imageCount: analysisResult.imageCount
    });
    
    return {
      success: true,
      data: analysisResult
    };
    
  } catch (error) {
    logger.error('AI analysis failed', { 
      error: error.message,
      stack: error.stack
    });
    
    return {
      success: false,
      error: error.message
    };
  }
});

// Generate default prompt for a cluster
ipcMain.handle('generate-default-prompt', async (event, clusterGroup, anchorContext = null) => {
  try {
    logger.info('Generating default prompt', { 
      representative: clusterGroup.mainRep?.representativeFilename,
      hasProvidedAnchor: !!anchorContext
    });
    
    const config = configManager.getAllSettings();
    const savedAnchorContext = config.aiAnalysis?.anchorContext;
    const finalAnchorContext = anchorContext !== null ? anchorContext : (savedAnchorContext || '');
    
    // ✅ Use AIAnalysisService to build prompt
    if (!aiAnalysisService) {
      aiAnalysisService = new AIAnalysisService(config);
    }
    
    // Build context for prompt generation
    const context = {
      filename: clusterGroup.mainRep?.representativeFilename || 'Unknown',
      existingKeywords: clusterGroup.mainRep?.keywords || [],
      gps: clusterGroup.mainRep?.gps || null,
      folderPath: clusterGroup.mainRep?.representativePath ? path.dirname(clusterGroup.mainRep.representativePath) : '',
      folderName: clusterGroup.mainRep?.representativePath ? path.basename(path.dirname(clusterGroup.mainRep.representativePath)) : '',
      totalImages: clusterGroup.allClusters?.length || 1,
      imageCount: {
        parents: 1 + (clusterGroup.similarReps?.length || 0),
        children: 0 // Will be calculated by service if needed
      }
    };
    
    // Build prompt using the anchor context
    const prompt = aiAnalysisService.buildPrompt(context, finalAnchorContext);
    
    logger.info('Default prompt generated', { 
      promptLength: prompt.length,
      hasGPS: !!context.gps,
      keywordCount: context.existingKeywords.length
    });
    
    return {
      success: true,
      prompt: prompt
    };
    
  } catch (error) {
    logger.error('Failed to generate default prompt', { 
      error: error.message,
      representative: clusterGroup.mainRep?.representativeFilename
    });
    
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('generate-xmp-files', async (event, data) => {
  try {
    logger.info('Generating XMP files for cluster', {
      clusterRep: data.cluster?.mainRep?.representativeFilename
    });
    
    if (!xmpGenerator) {
      throw new Error('XMP Generator not initialized');
    }
    
    // Send progress
    event.sender.send('progress-update', {
      stage: 'xmp-generation',
      message: 'Collecting files and generating XMP...',
      percent: 0
    });
    
    // ✅ Use the new generateXMPFiles method that handles ALL files
    const result = await xmpGenerator.generateXMPFiles(data);
    
    if (result.success) {
      logger.info('XMP generation complete', {
        total: result.filesProcessed,
        success: result.successCount,
        failed: result.failCount
      });
      
      event.sender.send('progress-update', {
        stage: 'xmp-generation',
        message: `XMP generation complete! ${result.successCount} files processed.`,
        percent: 100
      });
      
      return {
        success: true,
        count: result.successCount,
        filesProcessed: result.filesProcessed,
        results: result.results
      };
    } else {
      throw new Error(result.error || 'XMP generation failed');
    }
    
  } catch (error) {
    logger.error('XMP generation failed', {
      error: error.message,
      stack: error.stack
    });
    
    return {
      success: false,
      error: error.message
    };
  }
});

// Open external URLs (for Google Maps links)
ipcMain.handle('open-external', async (event, url) => {
  try {
    logger.info('Opening external URL', { url });
    
    // Validate URL for security
    if (!url || typeof url !== 'string') {
      throw new Error('Invalid URL provided');
    }
    
    // Only allow HTTPS URLs for security
    if (!url.startsWith('https://')) {
      throw new Error('Only HTTPS URLs are allowed');
    }
    
    // Use Electron's shell.openExternal
    const { shell } = require('electron');
    await shell.openExternal(url);
    
    return { success: true };
  } catch (error) {
    logger.error('Failed to open external URL', {
      url,
      error: error.message
    });
    
    return {
      success: false,
      error: error.message
    };
  }
});

/**
 * Helper function to extract EXIF data from image
 */
async function extractEXIFData(imagePath) {
  try {
    const exiftool = require('exiftool-vendored').exiftool;
    const tags = await exiftool.read(imagePath);
    
    return {
      DateTimeOriginal: tags.DateTimeOriginal || new Date().toISOString(),
      GPSLatitude: tags.GPSLatitude,
      GPSLongitude: tags.GPSLongitude
    };
  } catch (error) {
    logger.warn('Failed to extract EXIF data', { 
      imagePath,
      error: error.message 
    });
    
    // Return defaults
    return {
      DateTimeOriginal: new Date().toISOString(),
      GPSLatitude: null,
      GPSLongitude: null
    };
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 1250,
    minWidth: 1200,
    minHeight: 1000,
    icon: path.join(__dirname, '../../icon/Lightroom ICON.png'),  // App icon
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.loadFile('src/renderer/index.html');

  // Close splash when main window is ready
  win.once('ready-to-show', () => {
    if (splash && !splash.isDestroyed()) {
      splash.close();
      splash = null;
    }
  });
  
  // ✅ FIX CSP: Allow data URLs for images (SVG placeholders and base64 thumbnails)
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // CRITICAL: Allow both 'self' and data: URLs for images
        'Content-Security-Policy': [
          "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"
        ]
      }
    });
  });
  
  // Open DevTools in development
  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }
}

function createSplash() {
  try {
    splash = new BrowserWindow({
      width: 300,
      height: 300,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: false,
      movable: true,
      show: true,
      icon: path.join(__dirname, '../../icon/Lightroom ICON.png')
    });
    // Try to read icon from multiple locations to support packaged builds
    const candidateIconPaths = [
      path.join(__dirname, '../../icon/Lightroom ICON.png'),                // inside asar
      path.join(process.resourcesPath || '', 'icon', 'Lightroom ICON.png')  // unpacked extraResources
    ];

    let base64 = '';
    for (const p of candidateIconPaths) {
      try {
        const buf = fs.readFileSync(p);
        base64 = buf.toString('base64');
        break;
      } catch {}
    }

    // Final fallback: simple inline SVG so splash still renders
    const inlineImg = base64
      ? `data:image/png;base64,${base64}`
      : `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="250" height="250" viewBox="0 0 250 250"><rect width="250" height="250" rx="32" fill="#2b2b2b"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="#eaeaea" font-family="-apple-system,Helvetica,Arial" font-size="20">Loading…</text></svg>')}`;

    const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' data:; img-src 'self' data:; style-src 'self' 'unsafe-inline'" />
    <style>
      html, body { margin:0; padding:0; width:100%; height:100%; background:transparent; }
      .c { display:flex; align-items:center; justify-content:center; width:100%; height:100%; }
      .logo { width:250px; height:250px; object-fit:contain; }
    </style>
  </head>
  <body>
    <div class="c">
      <img class="logo" src="${inlineImg}" alt="Loading"/>
    </div>
  </body>
</html>`;

    splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  } catch (e) {
    logger.warn('Failed to create splash window', { error: e.message });
  }
}

app.whenReady().then(async () => {
  // Show splash immediately
  createSplash();
  // Set dock icon on macOS
  if (process.platform === 'darwin' && app.dock) {
    const iconPath = path.join(__dirname, '../../icon/Lightroom ICON.png');
    try {
      app.dock.setIcon(iconPath);
      logger.info('Dock icon set', { iconPath });
    } catch (error) {
      logger.error('Failed to set dock icon', { error: error.message, iconPath });
    }
  }
  
  // Run system check
  const systemCheck = new SystemCheck();
  const checkResults = await systemCheck.checkAll();
  
  if (!checkResults.allPassed) {
    logger.error('Required tools missing', checkResults.results);
    
    const missingTools = Object.entries(checkResults.results)
      .filter(([tool, result]) => !result.available && ['exiftool', 'sharp', 'imghash', 'database'].includes(tool))
      .map(([tool, result]) => `${tool}: ${result.message}${result.installCommand ? '\n  Install: ' + result.installCommand : ''}`)
      .join('\n\n');
    
    const response = await dialog.showMessageBox({
      type: 'error',
      title: 'Required Tools Missing',
      message: 'Cannot start - required tools are missing',
      detail: missingTools,
      buttons: ['Exit'],
      defaultId: 0
    });
    
    app.quit();
    return;
  }
  
  // Show warnings but allow startup
  if (checkResults.warnings && checkResults.warnings.length > 0) {
    logger.warn('System check warnings', checkResults.warnings);
    
    // Only show dialog if dcraw is missing
    if (!checkResults.results.dcraw.available) {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Optional Tool Missing',
        message: 'Some optional tools are missing',
        detail: '⚠️  dcraw: Not installed (optional)\n' +
                '   Some old CR2 files may fail to process\n' +
                '   Install with: brew install dcraw\n\n' +
                '   The application will work fine without dcraw for most images.',
        buttons: ['Continue Anyway'],
        defaultId: 0
      });
    }
  }
  
  // Check GPU status (Apple Silicon MPS / NVIDIA CUDA)
  try {
    await checkGPUStatus();
  } catch (error) {
    logger.warn('GPU status check failed', { error: error.message });
  }
  
  // Check database status
  const dbStatus = initializeDatabase();
  
  // Create window immediately - don't wait for CLIP service
  createWindow();
  
  // Start CLIP service asynchronously (non-blocking) after window is created
  // On first run, this may take several minutes to create venv, install deps, and download model
  setTimeout(async () => {
    try {
      logger.info('Starting CLIP similarity service in background...');
      await clipServiceManager.start();
      logger.info('✅ CLIP service started successfully');
    } catch (error) {
      logger.error('⚠️ CLIP service failed to start', { error: error.message });
      
      // Show warning but allow app to continue
      // Wait a bit for window to be ready before showing dialog
      setTimeout(() => {
        const windows = BrowserWindow.getAllWindows();
        const activeWindow = windows.length > 0 ? windows[0] : null;
        dialog.showMessageBox(activeWindow || null, {
          type: 'warning',
          title: 'CLIP Service Warning',
          message: 'CLIP similarity service failed to start',
          detail: `Error: ${error.message}\n\n` +
                  'Similarity detection will not work.\n\n' +
                  'To fix:\n' +
                  '1. Ensure Python 3 is installed\n' +
                  '2. Install dependencies: pip3 install fastapi transformers pillow torch uvicorn\n' +
                  '3. Restart the application',
          buttons: ['OK'],
          defaultId: 0
        }).catch(err => logger.warn('Failed to show CLIP warning dialog', { error: err.message }));
      }, 2000);
    }
  }, 1000); // Start 1 second after window is created

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // Check for Lightroom job after window is ready
  const windows = BrowserWindow.getAllWindows();
  if (windows.length > 0) {
    checkLightroomJob(windows[0]);
  }
});

/**
 * Check if the application was launched from Lightroom via a request.json file
 */
async function checkLightroomJob(window) {
  const requestPath = path.join(os.homedir(), 'Documents', 'LR_AI_Temp', 'request.json');
  
  if (fs.existsSync(requestPath)) {
    try {
      logger.info('🚀 Lightroom job detected!', { path: requestPath });
      const data = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
      
      if (data && data.images) {
        // Map Lightroom's request structure to a flat array of paths for the scanner
        const paths = data.images.map(img => img.path);
        
        // Wait for renderer to be ready before sending
        window.webContents.on('did-finish-load', () => {
          logger.info('Sending lightroom-job-loaded to renderer', { count: paths.length });
          window.webContents.send('lightroom-job-loaded', paths);
        });
        
        // Also send if already loaded
        if (!window.webContents.isLoading()) {
          logger.info('Renderer already ready, sending lightroom-job-loaded immediately');
          window.webContents.send('lightroom-job-loaded', paths);
        }
      }
    } catch (error) {
      logger.error('Failed to read Lightroom request.json', { error: error.message });
    }
  } else {
    logger.info('No Lightroom job detected on startup.');
  }
}

// Handler for writing response back to Lightroom
ipcMain.handle('write-lightroom-response', async (event, responseData) => {
  const responsePath = path.join(os.homedir(), 'Documents', 'LR_AI_Temp', 'response.json');
  
  try {
    logger.info('📝 Writing response to Lightroom...', { path: responsePath });
    fs.writeFileSync(responsePath, JSON.stringify(responseData, null, 2));
    logger.info('✅ Lightroom response written successfully');
    return { success: true };
  } catch (error) {
    logger.error('Failed to write Lightroom response.json', { error: error.message });
    return { success: false, error: error.message };
  }
});

app.on('window-all-closed', () => {
  app.quit();
});

// Clean up database connection on quit
app.on('before-quit', () => {
  // Stop CLIP service
  if (clipServiceManager) {
    clipServiceManager.stop();
  }
  
  databaseService.close();
});

