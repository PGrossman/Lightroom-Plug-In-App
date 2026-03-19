// src/services/configManager.js
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const PathHelper = require('../utils/pathHelper');

class ConfigManager {
  constructor() {
    // Get user data directory from Electron
    const { app } = require('electron');
    const userDataPath = app.getPath('userData');
    
    this.configPath = path.join(userDataPath, 'app-config.json');
    this.config = this.loadConfig();
  }

  /**
   * Load config from file, or create with defaults
   */
  loadConfig() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      logger.error('Failed to load config', { error: error.message });
    }

    // Return defaults if file doesn't exist or can't be read
    return {
      databasePath: null,
      lastUsedDirectory: null,
      timestampThreshold: 5
    };
  }

  /**
   * Save config to file
   */
  saveConfig() {
    try {
      const data = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(this.configPath, data, 'utf8');
      logger.info('Config saved', { configPath: this.configPath });
    } catch (error) {
      logger.error('Failed to save config', { error: error.message });
    }
  }

  /**
   * Get a config value
   */
  get(key, defaultValue = null) {
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }

  /**
   * Set a config value and save
   */
  set(key, value) {
    this.config[key] = value;
    this.saveConfig();
  }

  /**
   * Get database path from config
   */
  getDatabasePath() {
    return this.get('databasePath');
  }

  /**
   * Set database path in config
   */
  setDatabasePath(dbPath) {
    this.set('databasePath', dbPath);
    logger.info('Database path saved to config', { dbPath });
  }

  /**
   * Get last used directory
   */
  getLastUsedDirectory() {
    return this.get('lastUsedDirectory');
  }

  /**
   * Set last used directory
   */
  setLastUsedDirectory(dirPath) {
    this.set('lastUsedDirectory', dirPath);
  }

  /**
   * Get timestamp threshold
   */
  getTimestampThreshold() {
    return this.get('timestampThreshold', 5);
  }

  /**
   * Set timestamp threshold
   */
  setTimestampThreshold(seconds) {
    this.set('timestampThreshold', seconds);
  }

  /**
   * Get all settings
   */
  getAllSettings() {
    // Load the main project config.json file using PathHelper
    const projectConfigPath = PathHelper.getConfigPath();
    
    try {
      if (fs.existsSync(projectConfigPath)) {
        const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf8'));
        
        // Overlay user-config overrides onto project config for dynamic settings
        const merged = { ...projectConfig };
        const userGV = this.get('googleVision');
        if (userGV && typeof userGV === 'object') {
          merged.googleVision = { ...(merged.googleVision || {}), ...userGV };
        }
        const userAI = this.get('aiAnalysis');
        if (userAI && typeof userAI === 'object') {
          merged.aiAnalysis = { ...(merged.aiAnalysis || {}), ...userAI };
        }

        // Merge with user system-level settings
        merged.databasePath = this.getDatabasePath();
        merged.lastUsedDirectory = this.getLastUsedDirectory();
        merged.timestampThreshold = this.getTimestampThreshold();

        return merged;
      }
    } catch (error) {
      logger.error('Failed to load project config', { error: error.message });
    }
    
    // Fallback to user config only
    return {
      databasePath: this.getDatabasePath(),
      lastUsedDirectory: this.getLastUsedDirectory(),
      timestampThreshold: this.getTimestampThreshold()
    };
  }

  /**
   * Clear all settings (for testing)
   */
  clearAll() {
    this.config = {
      databasePath: null,
      lastUsedDirectory: null,
      timestampThreshold: 5
    };
    this.saveConfig();
    logger.info('All settings cleared');
  }
}

module.exports = ConfigManager;
