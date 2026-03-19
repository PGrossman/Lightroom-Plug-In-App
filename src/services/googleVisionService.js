const vision = require('@google-cloud/vision');
const path = require('path');
const logger = require('../utils/logger');

class GoogleVisionService {
  constructor(config) {
    this.config = config.googleVision || {};
    this.enabled = this.config.enabled || false;
    this.apiKey = this.config.apiKey || '';
    this.credentialsPath = this.config.credentialsPath || '';
    this.features = this.config.features || ['LABEL_DETECTION', 'OBJECT_LOCALIZATION', 'IMAGE_PROPERTIES'];
    this.logger = logger;
    
    // Initialize client if configured
    this.client = null;
    if (this.isConfigured()) {
      this.initializeClient();
    }
  }

  /**
   * Check if Google Vision is properly configured
   */
  isConfigured() {
    return this.enabled && (this.apiKey || this.credentialsPath);
  }

  /**
   * Initialize the Google Vision client
   */
  initializeClient() {
    try {
      if (this.apiKey) {
        // Use API key authentication
        this.client = new vision.ImageAnnotatorClient({
          apiKey: this.apiKey
        });
      } else if (this.credentialsPath) {
        // Use service account credentials
        this.client = new vision.ImageAnnotatorClient({
          keyFilename: this.credentialsPath
        });
      }
      
      this.logger.info('Google Vision client initialized', { 
        method: this.apiKey ? 'apiKey' : 'credentials',
        enabled: this.enabled 
      });
    } catch (error) {
      this.logger.error('Failed to initialize Google Vision client', { error: error.message });
      this.client = null;
    }
  }

  /**
   * Analyze image with Google Vision API
   */
  async analyzeImage(imagePath) {
    if (!this.client) {
      throw new Error('Google Vision client not initialized');
    }

    try {
      this.logger.info('Analyzing image with Google Vision', { imagePath });

      const [result] = await this.client.annotateImage({
        image: {
          source: {
            filename: imagePath
          }
        },
        features: this.features.map(feature => ({ type: feature }))
      });

      return result;
    } catch (error) {
      this.logger.error('Google Vision analysis failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Analyze image for metadata generation (formatted for our metadata structure)
   */
  async analyzeImageForMetadata(imagePath, context = {}) {
    try {
      const result = await this.analyzeImage(imagePath);
      
      // Extract labels
      const labels = result.labelAnnotations?.map(label => ({
        description: label.description,
        score: label.score
      })) || [];

      // Extract objects
      const objects = result.localizedObjectAnnotations?.map(obj => ({
        name: obj.name,
        score: obj.score,
        boundingPoly: obj.boundingPoly
      })) || [];

      // Extract image properties
      const dominantColors = result.imagePropertiesAnnotation?.dominantColors?.colors?.map(color => ({
        color: color.color,
        score: color.score,
        pixelFraction: color.pixelFraction
      })) || [];

      // Generate metadata structure
      const metadata = {
        confidence: 95, // Google Vision is generally very confident
        uncertainFields: [],
        title: this.generateTitle(labels, objects),
        description: this.generateDescription(labels, objects, context),
        caption: this.generateCaption(labels, objects),
        keywords: this.extractKeywords(labels, objects, context),
        category: this.determineCategory(labels, objects),
        sceneType: this.determineSceneType(labels, objects),
        location: this.extractLocation(labels, context),
        mood: this.determineMood(labels, dominantColors),
        timeOfDay: this.determineTimeOfDay(labels, dominantColors),
        subjects: this.extractSubjects(labels, objects),
        hashtags: this.generateHashtags(labels, objects, context),
        altText: this.generateAltText(labels, objects),
        provider: 'google_vision',
        rawData: {
          labels,
          objects,
          dominantColors
        }
      };

      this.logger.info('Google Vision metadata generated', { 
        title: metadata.title,
        category: metadata.category,
        confidence: metadata.confidence 
      });

      return metadata;

    } catch (error) {
      this.logger.error('Google Vision metadata generation failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate title from labels and objects
   */
  generateTitle(labels, objects) {
    const topLabels = labels.slice(0, 3).map(l => l.description);
    const topObjects = objects.slice(0, 2).map(o => o.name);
    
    const elements = [...topObjects, ...topLabels];
    return elements.slice(0, 3).join(' ').replace(/\b\w/g, l => l.toUpperCase());
  }

  /**
   * Generate description
   */
  generateDescription(labels, objects, context) {
    const primarySubjects = objects.map(o => o.name).slice(0, 2);
    const sceneContext = labels.find(l => 
      ['landscape', 'city', 'building', 'nature', 'outdoor', 'indoor'].includes(l.description.toLowerCase())
    );
    
    let description = `A photograph featuring ${primarySubjects.join(' and ')}`;
    if (sceneContext) {
      description += ` in a ${sceneContext.description} setting`;
    }
    
    if (context.folderName) {
      description += ` captured at ${context.folderName}`;
    }
    
    return description;
  }

  /**
   * Generate social media caption
   */
  generateCaption(labels, objects) {
    const topLabels = labels.slice(0, 2).map(l => l.description);
    const topObjects = objects.slice(0, 2).map(o => o.name);
    
    const elements = [...topObjects, ...topLabels];
    return elements.slice(0, 2).join(' • ');
  }

  /**
   * Extract keywords from labels and objects
   */
  extractKeywords(labels, objects, context) {
    const keywords = new Set();
    
    // Add object names
    objects.forEach(obj => keywords.add(obj.name.toLowerCase()));
    
    // Add high-confidence labels
    labels.filter(l => l.score > 0.7).forEach(label => {
      keywords.add(label.description.toLowerCase());
    });
    
    // Add context keywords
    if (context.existingKeywords) {
      context.existingKeywords.forEach(kw => keywords.add(kw.toLowerCase()));
    }
    
    return Array.from(keywords).slice(0, 7);
  }

  /**
   * Determine category
   */
  determineCategory(labels, objects) {
    const categoryMap = {
      'landscape': 'Landscape',
      'nature': 'Nature',
      'building': 'Architecture',
      'vehicle': 'Transportation',
      'aircraft': 'Aviation',
      'person': 'People',
      'animal': 'Wildlife',
      'food': 'Food',
      'sport': 'Sports'
    };
    
    for (const label of labels) {
      const lowerLabel = label.description.toLowerCase();
      for (const [key, category] of Object.entries(categoryMap)) {
        if (lowerLabel.includes(key)) {
          return category;
        }
      }
    }
    
    return 'General';
  }

  /**
   * Determine scene type
   */
  determineSceneType(labels, objects) {
    const sceneLabels = labels.map(l => l.description.toLowerCase());
    
    if (sceneLabels.some(l => ['landscape', 'nature', 'outdoor'].includes(l))) {
      return 'Landscape';
    } else if (sceneLabels.some(l => ['building', 'architecture'].includes(l))) {
      return 'Architecture';
    } else if (sceneLabels.some(l => ['portrait', 'person'].includes(l))) {
      return 'Portrait';
    } else if (sceneLabels.some(l => ['macro', 'close-up'].includes(l))) {
      return 'Macro';
    }
    
    return 'General';
  }

  /**
   * Extract location information
   */
  extractLocation(labels, context) {
    const location = { city: '', state: '', country: '', specificLocation: '' };
    
    // Try to extract from GPS context
    if (context.gps) {
      // This would need reverse geocoding in a real implementation
      location.specificLocation = `GPS: ${context.gps.latitude}, ${context.gps.longitude}`;
    }
    
    // Try to extract from folder context
    if (context.folderName) {
      location.specificLocation = context.folderName;
    }
    
    return location;
  }

  /**
   * Determine mood from colors and labels
   */
  determineMood(labels, colors) {
    const moodLabels = labels.map(l => l.description.toLowerCase());
    
    if (moodLabels.some(l => ['sunny', 'bright', 'daylight'].includes(l))) {
      return 'Bright and cheerful';
    } else if (moodLabels.some(l => ['dark', 'night', 'evening'].includes(l))) {
      return 'Moody and atmospheric';
    } else if (moodLabels.some(l => ['cloudy', 'overcast'].includes(l))) {
      return 'Calm and subdued';
    }
    
    return 'Neutral';
  }

  /**
   * Determine time of day
   */
  determineTimeOfDay(labels, colors) {
    const timeLabels = labels.map(l => l.description.toLowerCase());
    
    if (timeLabels.some(l => ['sunrise', 'dawn', 'morning'].includes(l))) {
      return 'Morning';
    } else if (timeLabels.some(l => ['sunset', 'dusk', 'evening'].includes(l))) {
      return 'Evening';
    } else if (timeLabels.some(l => ['night', 'dark'].includes(l))) {
      return 'Night';
    } else if (timeLabels.some(l => ['golden hour'].includes(l))) {
      return 'Golden Hour';
    }
    
    return 'Daytime';
  }

  /**
   * Extract main subjects
   */
  extractSubjects(labels, objects) {
    const subjects = new Set();
    
    objects.forEach(obj => subjects.add(obj.name));
    labels.filter(l => l.score > 0.8).slice(0, 3).forEach(label => {
      subjects.add(label.description);
    });
    
    return Array.from(subjects).slice(0, 3);
  }

  /**
   * Generate hashtags
   */
  generateHashtags(labels, objects, context) {
    const hashtags = new Set();
    
    // Add object hashtags
    objects.slice(0, 3).forEach(obj => {
      hashtags.add(`#${obj.name.toLowerCase().replace(/\s+/g, '')}`);
    });
    
    // Add category hashtags
    labels.filter(l => l.score > 0.7).slice(0, 5).forEach(label => {
      hashtags.add(`#${label.description.toLowerCase().replace(/\s+/g, '')}`);
    });
    
    // Add context hashtags
    if (context.folderName) {
      const folderTags = context.folderName.toLowerCase().split(/[\s\-_]+/).filter(tag => tag.length > 2);
      folderTags.slice(0, 2).forEach(tag => {
        hashtags.add(`#${tag}`);
      });
    }
    
    return Array.from(hashtags).slice(0, 10);
  }

  /**
   * Generate accessibility alt text
   */
  generateAltText(labels, objects) {
    const primaryObjects = objects.slice(0, 2).map(o => o.name);
    const sceneContext = labels.find(l => 
      ['landscape', 'city', 'building', 'nature'].includes(l.description.toLowerCase())
    );
    
    let altText = `Photograph of ${primaryObjects.join(' and ')}`;
    if (sceneContext) {
      altText += ` in a ${sceneContext.description} setting`;
    }
    
    return altText;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.enabled = this.config.enabled || false;
    this.apiKey = this.config.apiKey || '';
    this.credentialsPath = this.config.credentialsPath || '';
    
    if (this.isConfigured() && !this.client) {
      this.initializeClient();
    }
  }
}

module.exports = GoogleVisionService;
