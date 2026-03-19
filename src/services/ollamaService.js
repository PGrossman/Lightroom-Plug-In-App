const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class OllamaService {
  constructor(config) {
    this.endpoint = config.ollama?.endpoint || 'http://localhost:11434';
    this.model = config.ollama?.model || 'qwen2.5vl:latest';
    this.temperature = config.ollama?.temperature || 0.1;
    this.timeout = config.ollama?.timeout || 60000;
    this.logger = logger;
  }

  /**
   * Check if Ollama service is running
   */
  async isRunning() {
    try {
      const response = await axios.get(`${this.endpoint}/api/tags`, { timeout: 5000 });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if the vision model is available
   */
  async isVisionModelAvailable() {
    try {
      const response = await axios.get(`${this.endpoint}/api/tags`);
      const models = response.data.models || [];
      return models.some(model => model.name === this.model);
    } catch (error) {
      return false;
    }
  }

  /**
   * Encode image to base64
   */
  async encodeImage(imagePath) {
    try {
      const imageBuffer = await fs.readFile(imagePath);
      return imageBuffer.toString('base64');
    } catch (error) {
      throw new Error(`Failed to encode image: ${error.message}`);
    }
  }

  /**
   * Analyze image with vision model for metadata generation
   */
  async analyzeImageWithVision(imagePath, prompt) {
    try {
      // ✅ FIX: Check if image is RAW format, convert to JPG first
      let imageToAnalyze = imagePath;
      
      const ext = path.extname(imagePath).toLowerCase();
      const isRawFile = ['.cr2', '.cr3', '.nef', '.arw', '.dng'].includes(ext);
      
      if (isRawFile) {
        this.logger.info('Converting RAW file to JPG for Ollama', { imagePath });
        
        // Use ImageProcessor to convert RAW → JPG
        const ImageProcessor = require('./imageProcessor');
        const imageProcessor = new ImageProcessor();
        
        try {
          // Extract preview JPG from RAW
          imageToAnalyze = await imageProcessor.extractPreview(imagePath);
          this.logger.info('RAW conversion successful', { 
            original: path.basename(imagePath),
            preview: path.basename(imageToAnalyze)
          });
        } catch (conversionError) {
          throw new Error(
            `Cannot analyze RAW file: ${conversionError.message}\n\n` +
            'RAW files must be converted to JPG first. Ensure dcraw or exiftool is installed.'
          );
        }
      }
      
      const imageBase64 = await this.encodeImage(imageToAnalyze);

      const response = await axios.post(
        `${this.endpoint}/api/generate`,
        {
          model: this.model,
          prompt: prompt,
          images: [imageBase64],
          stream: false,
          options: {
            temperature: this.temperature,
            num_predict: 1000
          }
        },
        {
          timeout: this.timeout
        }
      );

      // Parse the response
      const result = this.parseJSONResponse(response.data.response);
      return result;

    } catch (error) {
      throw new Error(`Ollama vision analysis failed: ${error.message}`);
    }
  }

  /**
   * Parse JSON response from Ollama (handles markdown code blocks)
   */
  parseJSONResponse(responseText) {
    try {
      // Remove markdown code blocks if present
      let cleaned = responseText.trim();
      cleaned = cleaned.replace(/```json\n?/g, '').replace(/```\n?/g, '');
      
      // Find first { and last }
      const firstBrace = cleaned.indexOf('{');
      const lastBrace = cleaned.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1) {
        cleaned = cleaned.substring(firstBrace, lastBrace + 1);
      }
      
      const parsed = JSON.parse(cleaned);
      
      // Validate and provide defaults
      return {
        confidence: parsed.confidence || 75,
        uncertainFields: parsed.uncertainFields || [],
        title: parsed.title || '',
        description: parsed.description || '',
        caption: parsed.caption || '',
        keywords: parsed.keywords || [],
        category: parsed.category || '',
        sceneType: parsed.sceneType || '',
        location: parsed.location || { city: '', state: '', country: '', specificLocation: '' },
        mood: parsed.mood || '',
        subjects: parsed.subjects || [],
        hashtags: parsed.hashtags || [],
        altText: parsed.altText || ''
      };
      
    } catch (error) {
      this.logger.error('Failed to parse Ollama JSON response', { 
        error: error.message,
        response: responseText 
      });
      throw new Error(`JSON parsing failed: ${error.message}`);
    }
  }

  /**
   * Get available models
   */
  async getAvailableModels() {
    try {
      const response = await axios.get(`${this.endpoint}/api/tags`);
      return response.data.models || [];
    } catch (error) {
      throw new Error(`Failed to get models: ${error.message}`);
    }
  }

  /**
   * Pull a model
   */
  async pullModel(modelName) {
    try {
      const response = await axios.post(`${this.endpoint}/api/pull`, {
        name: modelName,
        stream: false
      });
      return response.data;
    } catch (error) {
      throw new Error(`Failed to pull model: ${error.message}`);
    }
  }
}

module.exports = OllamaService;
