const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class GeminiService {
  constructor(config) {
    this.config = config.googleVision || {}; // API key is stored in googleVision.apiKey
    this.apiKey = this.config.apiKey || '';
    // Model name may include "models/" prefix, strip it if present
    const modelName = config.aiAnalysis?.activeGeminiModel || 'gemini-2.5-pro';
    this.model = modelName.replace(/^models\//, ''); // Remove "models/" prefix if present
    // ✅ Get temperature from config (default to 0.3 for factual tasks)
    this.temperature = config.aiAnalysis?.geminiTemperature ?? 0.3;
    this.baseUrl = 'https://generativelanguage.googleapis.com';
    this.logger = logger;
  }

  /**
   * Check if Gemini is properly configured
   */
  isConfigured() {
    return !!(this.apiKey && this.model);
  }

  /**
   * Encode image to base64
   */
  async encodeImage(imagePath) {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      return imageBuffer.toString('base64');
    } catch (error) {
      throw new Error(`Failed to encode image: ${error.message}`);
    }
  }

  /**
   * Analyze image with Gemini Vision API
   */
  async analyzeImageWithVision(imagePath, prompt) {
    this.logger.info('Analyzing with Gemini', { 
      imagePath, 
      model: this.model,
      temperature: this.temperature,
      hasCustomPrompt: !!prompt 
    });

    if (!this.isConfigured()) {
      throw new Error('Gemini API key or model not configured. Please configure Google AI Studio in Settings.');
    }

    try {
      // Check if image is RAW format, convert to JPG first
      let imageToAnalyze = imagePath;
      const ext = path.extname(imagePath).toLowerCase();
      const isRawFile = ['.cr2', '.cr3', '.nef', '.arw', '.dng', '.psd', '.psb'].includes(ext);

      if (isRawFile) {
        this.logger.info('Converting RAW/PSD file to JPG for Gemini', { imagePath });
        const ImageProcessor = require('./imageProcessor');
        const imageProcessor = new ImageProcessor();
        
        try {
          imageToAnalyze = await imageProcessor.extractPreview(imagePath);
          this.logger.info('RAW/PSD conversion successful', {
            original: path.basename(imagePath),
            preview: path.basename(imageToAnalyze)
          });
        } catch (conversionError) {
          throw new Error(
            `Cannot analyze RAW/PSD file: ${conversionError.message}\n\n` +
            'RAW/PSD files must be converted to JPG first. Ensure exiftool is installed.'
          );
        }
      }

      // Encode image to base64
      const imageBase64 = await this.encodeImage(imageToAnalyze);
      
      // Determine MIME type
      const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';

      // Prepare request payload with temperature setting
      const payload = {
        contents: [{
          parts: [
            {
              text: prompt
            },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64
              }
            }
          ]
        }],
        generationConfig: {
          temperature: this.temperature
        }
      };

      // Ensure model name has "models/" prefix for API call
      const apiModelName = this.model.startsWith('models/') ? this.model : `models/${this.model}`;
      
      // Try v1beta first, then v1
      let response;
      try {
        response = await axios.post(
          `${this.baseUrl}/v1beta/${apiModelName}:generateContent?key=${this.apiKey}`,
          payload,
          {
            timeout: 60000,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      } catch (e1) {
        this.logger.warn('v1beta generateContent failed, retrying v1', { 
          error: e1.message, 
          model: apiModelName 
        });
        response = await axios.post(
          `${this.baseUrl}/v1/${apiModelName}:generateContent?key=${this.apiKey}`,
          payload,
          {
            timeout: 60000,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );
      }

      // Extract text response
      const responseText = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!responseText) {
        throw new Error('No response text from Gemini API');
      }

      // Parse JSON response (handles markdown code blocks)
      const result = this.parseJSONResponse(responseText);
      
      result.provider = 'gemini';
      result.model = this.model;

      this.logger.info('Gemini analysis complete', {
        confidence: result.confidence,
        model: this.model
      });

      return result;

    } catch (error) {
      this.logger.error('Gemini analysis failed', { 
        error: error.message,
        model: this.model,
        status: error.response?.status,
        statusText: error.response?.statusText
      });
      
      if (error.response?.status === 401 || error.response?.status === 403) {
        throw new Error('Invalid Gemini API key or API not enabled. Please check your API key in Settings.');
      }
      
      throw new Error(`Gemini vision analysis failed: ${error.message}`);
    }
  }

  /**
   * Parse JSON response from Gemini (handles markdown code blocks)
   */
  parseJSONResponse(responseText) {
    try {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const jsonText = jsonMatch ? jsonMatch[1] : responseText.trim();
      
      // Remove any leading/trailing whitespace
      const cleaned = jsonText.trim();
      
      // Parse JSON
      return JSON.parse(cleaned);
    } catch (error) {
      // If parsing fails, try to find JSON object in the text
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (e) {
          this.logger.warn('Failed to parse JSON from Gemini response', { 
            error: e.message,
            responsePreview: responseText.substring(0, 200)
          });
        }
      }
      
      // Fallback: return a basic structure
      this.logger.warn('Could not parse JSON response, using fallback structure');
      return {
        confidence: 75,
        uncertainFields: ['all'],
        title: 'Analysis failed',
        description: 'Failed to parse Gemini response',
        keywords: [],
        error: `Failed to parse response: ${error.message}`,
        rawResponse: responseText.substring(0, 500)
      };
    }
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    if (newConfig.googleVision?.apiKey) {
      this.apiKey = newConfig.googleVision.apiKey;
    }
    if (newConfig.aiAnalysis?.activeGeminiModel) {
      // Model name may include "models/" prefix, strip it if present
      const modelName = newConfig.aiAnalysis.activeGeminiModel;
      this.model = modelName.replace(/^models\//, ''); // Remove "models/" prefix if present
    }
    // ✅ Update temperature from config
    if (newConfig.aiAnalysis?.geminiTemperature !== undefined) {
      this.temperature = newConfig.aiAnalysis.geminiTemperature;
    }
  }
}

module.exports = GeminiService;

