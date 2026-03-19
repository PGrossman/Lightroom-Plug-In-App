const path = require('path');
const GeminiService = require('./geminiService');
const logger = require('../utils/logger');

class AIAnalysisService {
  constructor(config) {
    this.config = config; // Store config for strategy access
    this.geminiService = new GeminiService(config);
    this.logger = logger;
  }

  /**
   * Main analysis method using Gemini
   */
  async analyzeCluster(cluster, existingData = {}, _legacyProvider = null, customPrompt = null) {
    console.log('\n🤖 === AI ANALYSIS START ===');
    console.log('   Cluster:', cluster.mainRep?.representativeFilename || 'unknown');
    
    // FETCH GLOBAL ANCHOR CONTEXT DIRECTLY FROM SAVED SETTINGS
    const globalAnchorContext = this.config.aiAnalysis?.anchorContext || null;
    
    console.log('   Global Anchor Context:', globalAnchorContext);
    console.log('   Has Custom Prompt (Editor):', !!customPrompt);

    const context = this.buildContext(cluster, existingData);
    const repPath = cluster.mainRep.representativePath;

    if (!this.geminiService.isConfigured()) {
      throw new Error('Gemini API key or model not configured. Please configure Google AI Studio in Settings.');
    }

    let result;
    try {
      let prompt;
      
      if (customPrompt) {
        // If the user used the "Edit Prompt" button, use their exact words
        prompt = customPrompt;
      } else {
        // Otherwise, build the Expert Archivist prompt using the Global Anchor Context
        prompt = this.buildPrompt(context, globalAnchorContext);
      }
      
      this.logger.info('Using Gemini for analysis', { model: this.config.aiAnalysis?.activeGeminiModel });
      result = await this.geminiService.analyzeImageWithVision(repPath, prompt);
      
      // Parse and validate confidence
      if (!result.confidence || result.confidence < 0 || result.confidence > 100) {
        result.confidence = 85; // Default moderate confidence
      }
      
      this.logger.info('Gemini analysis complete', { 
        confidence: result.confidence,
        model: result.model,
        uncertainFields: result.uncertainFields
      });

    } catch (error) {
      this.logger.error('Gemini analysis failed', { error: error.message });
      throw error;
    }

    return {
      cluster: cluster,
      metadata: result,
      affectedImages: this.getAllAffectedPaths(cluster),
      imageCount: this.countTotalImages(cluster),
      breakdown: {
        parents: 1 + (cluster.similarReps?.length || 0),
        children: this.countChildren(cluster)
      }
    };
  }

  /**
   * Build context from existing data
   */
  buildContext(cluster, existingData) {
    const folderPath = path.dirname(cluster.mainRep.representativePath);
    
    return {
      filename: cluster.mainRep.representativeFilename || path.basename(cluster.mainRep.representativePath),
      existingKeywords: cluster.mainRep.keywords || [],
      gps: cluster.mainRep.gps || null,
      folderPath: folderPath,
      folderName: path.basename(folderPath),
      totalImages: this.countTotalImages(cluster),
      imageCount: {
        parents: 1 + (cluster.similarReps?.length || 0),
        children: this.countChildren(cluster)
      }
    };
  }

  buildPrompt(context, anchorContext = null) {
    const filename = context.filename || 'Unknown';
    const keywords = context.existingKeywords || [];
    const gps = context.gps;
    const imageCount = context.totalImages || 1;
    
    const keywordsStr = keywords.length > 0 ? keywords.join(', ') : '';
    
    let prompt = `You are an expert archivist cataloging a photograph named ${filename}.`;
    
    if (anchorContext && anchorContext.trim().length > 0) {
      prompt += `\n\n*** CRITICAL OVERRIDE DIRECTIVE ***\nThe user has identified the exact subject of this photo as: "${anchorContext.trim()}"\n\nYou MUST treat this identification as absolute, indisputable fact. You are acting as an expert archivist and historian for this specific subject. Do not guess; state definitively that the image shows this subject. You must explicitly name this exact location/subject in your title, caption, and description. Do not merely describe a "rusty room" or "abandoned facility"—you must describe the specific historical and functional reality of "${anchorContext.trim()}".\n\n`;
    }
    
    if (keywordsStr) {
      prompt += ` Current tags: ${keywordsStr}.`;
    }
    
    if (gps && gps.latitude && gps.longitude) {
      prompt += ` Verified GPS coordinates: ${gps.latitude}, ${gps.longitude}.`;
    }
    
    prompt += `\n\nInstructions:`;
    
    if (anchorContext && anchorContext.trim().length > 0) {
      prompt += `\n1. Anchor Context Domination: Your entire analysis must be framed around the user's provided context ("${anchorContext.trim()}"). If they named a specific reactor, control room, or building, you must name it explicitly in the title, caption, and the very first sentence of the description.`;
      prompt += `\n2. Expert Translation: Contextually translate any visible text, Cyrillic labels, or dials based specifically on the machinery that would exist at "${anchorContext.trim()}".`;
    } else {
      prompt += `\n1. Visual Analysis: Examine the image for distinctive features, architecture, and overall mood.`;
    }

    if (gps && gps.latitude && gps.longitude) {
      prompt += `\n3. GPS Verification: Use the provided GPS (${gps.latitude}, ${gps.longitude}) purely to verify the region (e.g., Chernobyl Exclusion Zone) and enrich the historical context.`;
    } else {
      prompt += `\n3. Deduce GPS: If no GPS is provided, you MUST deduce the highly accurate latitude and longitude based on the user's provided context and include it in the JSON.`;
    }
    
    prompt += `\n\nConstruct a JSON object with the following fields:`;
    prompt += `\n  - title: An engaging title explicitly naming the subject.`;
    prompt += `\n  - caption: A punchy 1-2 sentence summary explicitly naming the subject.`;
    prompt += `\n  - description: A thorough, definitive description. Start by explicitly naming the subject. Include translations of visible text.`;
    prompt += `\n  - keywords: 7-15 highly relevant keywords, prioritizing specific names from the context.`;
    prompt += `\n  - location: A detailed description of the identified location.`;
    prompt += `\n  - gps: An object with 'latitude' and 'longitude' (number format). Provide this ONLY IF deduced from context or provided to you.`;
    prompt += `\n  - technicalDetails: Observations on lighting or composition.`;
    prompt += `\n  - confidence: Your confidence level (0.0 to 1.0).`;
    prompt += `\n  - uncertainFields: An array listing any fields you are unsure about.`;
    
    if (imageCount > 1) {
      prompt += `\n\nThis image is part of a cluster of ${imageCount} related images.`;
    }
    
    prompt += `\n\nOutput ONLY valid JSON in this exact format:`;
    prompt += `\n{`;
    prompt += `\n  "title": "Descriptive title here",`;
    prompt += `\n  "caption": "Short, punchy 1-2 sentence engaging summary",`;
    prompt += `\n  "description": "Detailed, definitive description of what you see, including translations.",`;
    prompt += `\n  "keywords": ["keyword1", "keyword2", "keyword3"],`;
    prompt += `\n  "location": "Location description or null",`;
    prompt += `\n  "gps": {"latitude": 51.3895, "longitude": 30.0991},`;
    prompt += `\n  "technicalDetails": "Technical observations or null",`;
    prompt += `\n  "confidence": 0.95,`;
    prompt += `\n  "uncertainFields": []`;
    prompt += `\n}`;
    
    return prompt;
  }

  /**
   * Count total images in cluster (parents + children)
   */
  countTotalImages(cluster) {
    const parents = 1 + (cluster.similarReps?.length || 0);
    const children = this.countChildren(cluster);
    return parents + children;
  }

  /**
   * Count all child images (bracketed + derivatives)
   */
  countChildren(cluster) {
    let total = 0;
    
    // Main rep's bracketed images (exclude the rep itself)
    if (cluster.mainRep.isBracketed && cluster.mainRep.imageCount) {
      total += cluster.mainRep.imageCount - 1;
    }
    
    // Similar reps' bracketed images
    if (cluster.similarReps) {
      cluster.similarReps.forEach(sim => {
        if (sim.cluster.isBracketed && sim.cluster.imageCount) {
          total += sim.cluster.imageCount;
        }
      });
    }
    
    return total;
  }

  /**
   * Get all image paths that will receive this XMP
   */
  getAllAffectedPaths(cluster) {
    const paths = [];
    
    // Add main representative
    paths.push(cluster.mainRep.representativePath);
    
    // Add main rep's bracketed images
    if (cluster.mainRep.imagePaths) {
      cluster.mainRep.imagePaths.forEach(imgPath => {
        if (imgPath !== cluster.mainRep.representativePath) {
          paths.push(imgPath);
        }
      });
    }
    
    // Add similar representatives and their images
    if (cluster.similarReps) {
      cluster.similarReps.forEach(sim => {
        paths.push(sim.cluster.representativePath);
        
        if (sim.cluster.imagePaths) {
          sim.cluster.imagePaths.forEach(imgPath => {
            if (imgPath !== sim.cluster.representativePath) {
              paths.push(imgPath);
            }
          });
        }
      });
    }
    
    // Remove duplicates
    return [...new Set(paths)];
  }
}

module.exports = AIAnalysisService;
