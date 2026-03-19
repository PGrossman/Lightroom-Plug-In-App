// src/services/similarityDetector.js
const axios = require('axios');
const path = require('path');

class SimilarityDetector {
  constructor(config) {
    // Use project/user config when available; fall back to a conservative 80%
    this.threshold = config?.similarity?.hammingThreshold ?? 80; // percentage (0-100)
    this.serviceUrl = 'http://127.0.0.1:8765';
    this.logger = require('../utils/logger');
  }

  /**
   * Check if CLIP service is available
   */
  async checkService() {
    try {
      const response = await axios.get(`${this.serviceUrl}/health`, { timeout: 2000 });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate CLIP embeddings for all images
   */
  async generateEmbeddings(imagePaths) {
    try {
      const response = await axios.post(`${this.serviceUrl}/embeddings`, {
        paths: imagePaths
      }, { timeout: 120000 }); // 120 second timeout for huge model

      // Log failed images if any
      if (response.data.failed && response.data.failed.length > 0) {
        this.logger.warn('Some images failed to process', { failed: response.data.failed });
      }

      return response.data.embeddings;
    } catch (error) {
      this.logger.error('CLIP embedding generation failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Calculate similarity between two embeddings
   */
  async calculateSimilarity(emb1, emb2) {
    try {
      const response = await axios.post(`${this.serviceUrl}/similarity`, {
        emb1,
        emb2
      });

      return response.data.similarity;
    } catch (error) {
      this.logger.error('Similarity calculation failed', { error: error.message });
      return 0;
    }
  }

  /**
   * Find similar representatives among cluster representatives
   * @param {Array<string>} representativePaths - Paths to representative images
   * @returns {Promise<Array>} Array of similarity matches
   */
  async findSimilarRepresentatives(representativePaths) {
    this.logger.info(`Checking similarity for ${representativePaths.length} representatives with CLIP...`);
    
    if (representativePaths.length < 2) {
      return []; // Need at least 2 to compare
    }

    // Check if service is running
    const serviceAvailable = await this.checkService();
    if (!serviceAvailable) {
      this.logger.error('CLIP service not available at ' + this.serviceUrl);
      throw new Error('CLIP similarity service is not running. Start it with: python3 similarity_service.py');
    }

    try {
      // Generate embeddings for all representatives at once
      this.logger.info('Generating CLIP embeddings for representatives');
      const embeddings = await this.generateEmbeddings(representativePaths);

      // Map embeddings back to paths
      const embeddingMap = new Map();
      representativePaths.forEach((path, idx) => {
        if (embeddings[idx]) {
          embeddingMap.set(path, embeddings[idx]);
        }
      });

      this.logger.info('Embeddings generated', { 
        total: representativePaths.length,
        successful: embeddingMap.size 
      });

      // Compare all pairs
      const paths = Array.from(embeddingMap.keys());
      const similar = [];
      let comparisons = 0;

      for (let i = 0; i < paths.length; i++) {
        for (let j = i + 1; j < paths.length; j++) {
          const path1 = paths[i];
          const path2 = paths[j];

          const similarity = await this.calculateSimilarity(
            embeddingMap.get(path1),
            embeddingMap.get(path2)
          );

          comparisons++;

          // Convert to percentage
          const similarityPercent = Math.round(similarity * 100);

          // ✅ ADD THIS - Always log the similarity score
          this.logger.info('CLIP Comparison Result', {
            file1: path.basename(path1),
            file2: path.basename(path2),
            rawSimilarity: similarity,
            similarityPercent: `${similarityPercent}%`,
            threshold: `${this.threshold}%`,
            matched: similarityPercent >= this.threshold
          });

          // Check if above threshold
          if (similarityPercent >= this.threshold) {
            similar.push({
              rep1: path1,
              rep2: path2,
              similarity,
              similarityPercent,
              fileName1: path.basename(path1),
              fileName2: path.basename(path2)
            });

            this.logger.info(`CLIP similar representatives found: ${path.basename(path1)} ↔ ${path.basename(path2)} (${similarityPercent}%)`);
          }
        }
      }

      this.logger.info(`CLIP similarity detection complete`, {
        comparisons,
        similarPairs: similar.length,
        threshold: `${this.threshold}%`
      });

      return similar;

    } catch (error) {
      this.logger.error('CLIP similarity detection failed:', error);
      return [];
    }
  }

  /**
   * Group similar representatives into clusters
   * Uses union-find algorithm for connected components
   */
  groupSimilarRepresentatives(similarPairs, allRepresentatives) {
    const parent = new Map();
    
    // Initialize each representative as its own parent
    allRepresentatives.forEach(rep => parent.set(rep, rep));

    // Union operation for each similar pair
    const find = (x) => {
      if (parent.get(x) !== x) {
        parent.set(x, find(parent.get(x)));
      }
      return parent.get(x);
    };

    const union = (x, y) => {
      const rootX = find(x);
      const rootY = find(y);
      if (rootX !== rootY) {
        parent.set(rootX, rootY);
      }
    };

    // Group similar pairs
    similarPairs.forEach(pair => {
      union(pair.rep1, pair.rep2);
    });

    // Build final groups
    const groups = new Map();
    allRepresentatives.forEach(rep => {
      const root = find(rep);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root).push(rep);
    });

    // Convert to array and filter single-member groups
    return Array.from(groups.values()).filter(group => group.length > 1);
  }

  // Keep old methods for backwards compatibility but mark as deprecated
  async generateHash(imagePath) {
    throw new Error('Perceptual hashing deprecated - using CLIP embeddings instead');
  }

  hammingDistance(hash1, hash2) {
    throw new Error('Hamming distance deprecated - using cosine similarity instead');
  }

  distanceToPercent(distance) {
    throw new Error('Distance conversion deprecated - using direct similarity score instead');
  }
}

module.exports = SimilarityDetector;