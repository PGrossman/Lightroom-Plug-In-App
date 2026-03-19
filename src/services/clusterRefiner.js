// src/services/clusterRefiner.js
const path = require('path');
const logger = require('../utils/logger');

class ClusterRefiner {
  constructor(imageProcessor) {
    this.imageProcessor = imageProcessor;
    this.hammingDistance = require('hamming-distance');
  }

  /**
   * Refine a cluster into sub-groups based on perceptual hash similarity
   * Returns array of sub-groups, each with a representative and similar images
   */
  async refineCluster(clusterImages, threshold = 13) {
    try {
      logger.info('Refining cluster', { 
        imageCount: clusterImages.length,
        threshold 
      });

      // Generate hashes for all images in the cluster
      const imageHashes = [];
      
      for (const image of clusterImages) {
        try {
          const result = await this.imageProcessor.processImage(image.path);
          
          if (result.success) {
            imageHashes.push({
              path: image.path,
              hash: result.hash,
              previewPath: result.previewPath,
              image: image
            });
          } else {
            logger.warn('Failed to process image in cluster', { 
              path: image.path,
              error: result.error 
            });
          }
        } catch (error) {
          logger.error('Error processing image', { 
            path: image.path, 
            error: error.message 
          });
        }
      }

      if (imageHashes.length === 0) {
        logger.warn('No images could be processed for clustering');
        return [{
          representative: clusterImages[0].path,
          images: clusterImages.map(img => img.path),
          similarityScore: 0
        }];
      }

      // Group images by similarity
      const subGroups = this.groupBySimilarity(imageHashes, threshold);

      logger.info('Cluster refined', { 
        originalCount: clusterImages.length,
        subGroupCount: subGroups.length,
        subGroupSizes: subGroups.map(g => g.images.length)
      });

      return subGroups;

    } catch (error) {
      logger.error('Failed to refine cluster', { error: error.message });
      throw error;
    }
  }

  /**
   * Group images by hash similarity using a greedy clustering algorithm
   */
  groupBySimilarity(imageHashes, threshold) {
    const groups = [];
    const processed = new Set();

    // Sort by timestamp if available (process in chronological order)
    const sorted = [...imageHashes].sort((a, b) => {
      const timeA = a.image.timestamp || 0;
      const timeB = b.image.timestamp || 0;
      return timeA - timeB;
    });

    for (const image of sorted) {
      if (processed.has(image.path)) {
        continue;
      }

      // Start a new group with this image
      const group = {
        representative: image.path,
        representativeHash: image.hash,
        images: [image.path],
        hashes: [image.hash],
        previewPath: image.previewPath
      };

      processed.add(image.path);

      // Find all similar images
      for (const other of sorted) {
        if (processed.has(other.path)) {
          continue;
        }

        const distance = this.calculateDistance(image.hash, other.hash);
        
        if (distance < threshold) {
          group.images.push(other.path);
          group.hashes.push(other.hash);
          processed.add(other.path);
        }
      }

      // Calculate average similarity within group
      group.similarityScore = this.calculateGroupSimilarity(group.hashes);

      groups.push(group);
    }

    return groups;
  }

  /**
   * Calculate Hamming distance between two hashes
   */
  calculateDistance(hash1, hash2) {
    if (!hash1 || !hash2 || hash1.length !== hash2.length) {
      return Infinity;
    }

    try {
      // Use hamming-distance library if available
      if (this.hammingDistance) {
        return this.hammingDistance(hash1, hash2);
      }

      // Fallback: manual calculation
      let distance = 0;
      for (let i = 0; i < hash1.length; i++) {
        if (hash1[i] !== hash2[i]) {
          distance++;
        }
      }
      return distance;

    } catch (error) {
      logger.error('Distance calculation failed', { error: error.message });
      return Infinity;
    }
  }

  /**
   * Calculate average similarity score within a group (0-100%)
   */
  calculateGroupSimilarity(hashes) {
    if (hashes.length < 2) {
      return 100; // Single image = 100% similar to itself
    }

    let totalDistance = 0;
    let comparisons = 0;

    for (let i = 0; i < hashes.length; i++) {
      for (let j = i + 1; j < hashes.length; j++) {
        const distance = this.calculateDistance(hashes[i], hashes[j]);
        totalDistance += distance;
        comparisons++;
      }
    }

    const avgDistance = totalDistance / comparisons;
    const maxDistance = hashes[0].length * 4; // Approximate max for hex strings
    const similarity = Math.max(0, Math.min(100, 100 - (avgDistance / maxDistance * 100)));

    return Math.round(similarity);
  }

  /**
   * Refine multiple clusters in batch
   */
  async refineBatch(clusters, threshold = 13, progressCallback = null) {
    const results = [];
    const total = clusters.length;

    for (let i = 0; i < clusters.length; i++) {
      const cluster = clusters[i];
      
      try {
        const subGroups = await this.refineCluster(cluster.images, threshold);
        
        results.push({
          originalCluster: cluster,
          subGroups: subGroups,
          wasRefined: subGroups.length > 1
        });

      } catch (error) {
        logger.error('Failed to refine cluster in batch', { 
          cluster: cluster.representative,
          error: error.message 
        });
        
        // Keep original cluster if refinement fails
        results.push({
          originalCluster: cluster,
          subGroups: [{
            representative: cluster.representative,
            images: cluster.images.map(img => img.path),
            similarityScore: 0
          }],
          wasRefined: false,
          error: error.message
        });
      }

      if (progressCallback) {
        progressCallback({
          current: i + 1,
          total,
          percent: Math.round(((i + 1) / total) * 100),
          cluster: path.basename(cluster.representative)
        });
      }
    }

    const refined = results.filter(r => r.wasRefined).length;
    const totalSubGroups = results.reduce((sum, r) => sum + r.subGroups.length, 0);

    logger.info('Batch refinement complete', { 
      totalClusters: total,
      refined,
      totalSubGroups 
    });

    return results;
  }

  /**
   * Get statistics about refinement results
   */
  getRefinementStats(results) {
    const stats = {
      totalClusters: results.length,
      refinedClusters: 0,
      unchangedClusters: 0,
      totalSubGroups: 0,
      averageSubGroupsPerCluster: 0,
      averageSimilarityScore: 0
    };

    let totalSimilarity = 0;
    let similarityCount = 0;

    results.forEach(result => {
      if (result.wasRefined) {
        stats.refinedClusters++;
      } else {
        stats.unchangedClusters++;
      }

      stats.totalSubGroups += result.subGroups.length;

      result.subGroups.forEach(group => {
        totalSimilarity += group.similarityScore;
        similarityCount++;
      });
    });

    stats.averageSubGroupsPerCluster = (stats.totalSubGroups / stats.totalClusters).toFixed(2);
    stats.averageSimilarityScore = similarityCount > 0 
      ? Math.round(totalSimilarity / similarityCount) 
      : 0;

    return stats;
  }
}

module.exports = ClusterRefiner;


