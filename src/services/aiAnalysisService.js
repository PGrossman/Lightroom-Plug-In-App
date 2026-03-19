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
  async analyzeCluster(cluster, existingData = {}, _legacyProvider = null, customPromptOrAnchor = null) {
    console.log('\n🤖 === AI ANALYSIS START ===');
    console.log('   Cluster:', cluster.mainRep?.representativeFilename || 'unknown');
    console.log('   hasAnchorContext:', !!customPromptOrAnchor);
    
    const anchorContext = customPromptOrAnchor; // The UI sends the anchor context here
    const context = this.buildContext(cluster, existingData);
    const repPath = cluster.mainRep.representativePath;

    if (!this.geminiService.isConfigured()) {
      throw new Error('Gemini API key or model not configured. Please configure Google AI Studio in Settings.');
    }

    let result;
    try {
      const prompt = this.buildPrompt(context, anchorContext);
      
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
    
    let prompt = `Analyze the provided photograph, named ${filename}.`;
    
    if (anchorContext && anchorContext.trim().length > 0) {
      prompt += `\n\nUSER-PROVIDED CONTEXT FOR THIS IMAGE: "${anchorContext.trim()}"\nCRITICAL INSTRUCTION: You MUST treat this context as ABSOLUTE FACT. You are acting as an expert archivist and historian for this specific subject. Do not guess; state definitively that the image shows this subject. Use this context to identify specific machinery, architecture, or historical details. If there is visible text (e.g., signs, dials, Cyrillic), you MUST attempt to read and translate it contextually based on this location.\n\n`;
    }
    
    if (keywordsStr) {
      prompt += ` The image is already tagged with: ${keywordsStr}.`;
    }
    
    if (gps && gps.latitude && gps.longitude) {
      prompt += ` The provided GPS coordinates are: Latitude: ${gps.latitude}, Longitude: ${gps.longitude}.`;
    }
    
    prompt += `\n\nYour task is to generate detailed metadata for this image.`;
    prompt += `\n\nInstructions:`;
    
    if (anchorContext && anchorContext.trim().length > 0) {
      prompt += `\n- Deep Contextual Analysis: Seamlessly and assertively integrate the Anchor Context. Name specific objects, translate visible text, and describe the historical/functional significance of what is in the frame.`;
    }

    if (gps && gps.latitude && gps.longitude) {
      prompt += `\n- Prioritize Provided GPS: Use the provided GPS coordinates (${gps.latitude}, ${gps.longitude}) to accurately identify the specific location, region, and context to enrich your description.`;
    } else {
      prompt += `\n- Deduce GPS: No GPS coordinates were provided. If the Anchor Context names a specific real-world geographical location (e.g., "Chernobyl Reactor 4"), you MUST deduce its approximate GPS coordinates (latitude and longitude) and include them in the JSON response.`;
    }
    
    prompt += `\n- Construct Metadata: Create a JSON object with the following fields:`;
    prompt += `\n  - title: A specific and engaging title for the image.`;
    prompt += `\n  - caption: A short, engaging 1-2 sentence summary.`;
    prompt += `\n  - description: A thorough, definitive description of the scene, including translations of visible text and identification of specific elements.`;
    prompt += `\n  - keywords: 7-15 highly relevant keywords.`;
    prompt += `\n  - location: A detailed description of the identified location.`;
    prompt += `\n  - gps: An object with 'latitude' and 'longitude' (number format). Provide this ONLY IF you can confidently deduce it from the Anchor Context or if it was provided to you, otherwise null.`;
    prompt += `\n  - technicalDetails: Observations on lighting or composition.`;
    prompt += `\n  - confidence: Your confidence level (0.0 to 1.0).`;
    prompt += `\n  - uncertainFields: An array listing any fields you are unsure about.`;
    
    if (imageCount > 1) {
      prompt += `\n\nThis image is part of a cluster of ${imageCount} related images.`;
    }
    
    prompt += `\n\nOutput the result in the specified JSON format EXACTLY:`;
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
    
    // TODO: Add derivatives count when derivative tracking is implemented
    
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
    
    // TODO: Add derivatives when implemented
    
    // Remove duplicates
    return [...new Set(paths)];
  }
}

module.exports = AIAnalysisService;
