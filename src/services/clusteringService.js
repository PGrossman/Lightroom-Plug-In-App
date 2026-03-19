// src/services/clusteringService.js
const logger = require('../utils/logger');

class ClusteringService {
  constructor(exifExtractor) {
    this.exifExtractor = exifExtractor;
  }

  /**
   * Group images by timestamp proximity (within specified seconds)
   * Returns array of clusters, each containing images taken within the time window
   */
  async clusterByTimestamp(imagePaths, secondsThreshold = 5) {
    logger.info('Starting timestamp clustering', { 
      imageCount: imagePaths.length,
      threshold: `${secondsThreshold}s`
    });

    const startTime = Date.now();
    
    // Extract timestamps for all images
    const imageData = [];
    for (const imagePath of imagePaths) {
      const timestamp = await this.exifExtractor.extractFromRAW(imagePath);
      
      if (timestamp) {
        imageData.push({
          path: imagePath,
          timestamp: timestamp
        });
      } else {
        logger.warn('Skipping image without timestamp', { imagePath });
      }
    }

    // Sort by timestamp
    imageData.sort((a, b) => a.timestamp - b.timestamp);

    // Create clusters using sliding window approach
    const clusters = [];
    let currentCluster = null;

    for (const image of imageData) {
      if (!currentCluster) {
        // Start first cluster
        currentCluster = {
          images: [image.path],
          timestamps: [image.timestamp],
          startTime: image.timestamp,
          endTime: image.timestamp,
          representative: null
        };
      } else {
        // Check if this image belongs to current cluster
        const timeDiff = image.timestamp - currentCluster.startTime;
        
        if (timeDiff <= (secondsThreshold * 1000)) {
          // Add to current cluster
          currentCluster.images.push(image.path);
          currentCluster.timestamps.push(image.timestamp);
          currentCluster.endTime = image.timestamp;
        } else {
          // Start new cluster
          clusters.push(currentCluster);
          
          currentCluster = {
            images: [image.path],
            timestamps: [image.timestamp],
            startTime: image.timestamp,
            endTime: image.timestamp,
            representative: null
          };
        }
      }
    }

    // Don't forget the last cluster
    if (currentCluster && currentCluster.images.length > 0) {
      clusters.push(currentCluster);
    }

    // Select representative for each cluster
    for (const cluster of clusters) {
      cluster.representative = this.selectRepresentative(cluster);
    }

    const duration = Date.now() - startTime;
    
    logger.info('Timestamp clustering complete', {
      duration: `${duration}ms`,
      totalClusters: clusters.length,
      singletonClusters: clusters.filter(c => c.images.length === 1).length,
      multiImageClusters: clusters.filter(c => c.images.length > 1).length
    });

    return clusters;
  }

  /**
   * Select the representative image from a cluster
   * For now, select the middle image (typically best exposure in bracketed sequence)
   * Can be enhanced with quality assessment later
   */
  selectRepresentative(cluster) {
    if (cluster.images.length === 1) {
      return cluster.images[0];
    }

    // Select middle image (assuming bracketed sequence: -2, 0, +2 EV)
    const middleIndex = Math.floor(cluster.images.length / 2);
    return cluster.images[middleIndex];
  }

  /**
   * Get statistics about clustering results
   */
  getClusteringStats(clusters) {
    const stats = {
      totalClusters: clusters.length,
      totalImages: 0,
      singletonClusters: 0,
      bracketedClusters: 0,
      largestCluster: 0,
      averageClusterSize: 0
    };

    for (const cluster of clusters) {
      stats.totalImages += cluster.images.length;
      
      if (cluster.images.length === 1) {
        stats.singletonClusters++;
      } else {
        stats.bracketedClusters++;
      }
      
      if (cluster.images.length > stats.largestCluster) {
        stats.largestCluster = cluster.images.length;
      }
    }

    stats.averageClusterSize = stats.totalImages / stats.totalClusters;

    return stats;
  }

  /**
   * Format cluster data for display
   */
  formatClusterForDisplay(cluster, index) {
    const path = require('path');
    
    logger.debug('Formatting cluster for display', {
      clusterIndex: index,
      originalRepresentative: cluster.representative,
      isAbsolute: cluster.representative?.startsWith('/'),
      imageCount: cluster.images ? cluster.images.length : cluster.imageCount,
      fileType: cluster.fileType
    });
    
    return {
      id: index,
      representative: cluster.representative, // KEEP FULL PATH HERE
      representativePath: cluster.representative, // Full path
      representativeFilename: path.basename(cluster.representative), // Just filename for display
      imageCount: cluster.images ? cluster.images.length : cluster.imageCount,
      images: cluster.images ? cluster.images.map(p => path.basename(p)) : [],
      imagePaths: cluster.images || cluster.imagePaths || [], // KEEP FULL PATHS
      startTime: this.exifExtractor.formatTimestamp(cluster.startTime),
      endTime: this.exifExtractor.formatTimestamp(cluster.endTime),
      duration: cluster.endTime && cluster.startTime 
        ? ((cluster.endTime - cluster.startTime) / 1000).toFixed(1) + 's' 
        : '0s',
      isBracketed: cluster.imageCount > 1 || (cluster.images && cluster.images.length > 1),
      fileType: cluster.fileType,
      hasGPS: cluster.hasGPS || false
    };
  }
}

module.exports = ClusteringService;

