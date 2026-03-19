// src/services/folderKeywordParser.js
const path = require('path');
const logger = require('../utils/logger');

class FolderKeywordParser {
  constructor() {
    // Common date patterns to strip
    this.datePatterns = [
      /^\d{4}[-_]\d{2}[-_]\d{2}[-_]/,  // YYYY-MM-DD- or YYYY_MM_DD_
      /^\d{4}[-_]\d{2}[-_]\d{2}/,       // YYYY-MM-DD or YYYY_MM_DD
      /^\d{4}[-_]\d{2}[-_]/,             // YYYY-MM- or YYYY_MM_
      /^\d{4}[-_]\d{2}/,                 // YYYY-MM or YYYY_MM
      /^\d{8}[-_]/,                      // YYYYMMDD- or YYYYMMDD_
      /^\d{8}/,                          // YYYYMMDD
      /^\d{6}[-_]/,                      // YYMMDD- or YYMMDD_
      /^\d{6}/                           // YYMMDD
    ];

    // Patterns to clean up
    this.cleanupPatterns = [
      /^\d+\s*[-_]\s*/,                  // Leading numbers like "100 - " or "01_"
      /[-_]{2,}/g,                       // Multiple dashes/underscores
      /^\s+|\s+$/g                       // Leading/trailing spaces
    ];
  }

  /**
   * Parse keywords from folder path
   * Returns: { primary, secondary, all, hierarchical }
   */
  parseKeywords(folderPath) {
    try {
      const parts = folderPath.split(path.sep).filter(p => p);
      
      // Get the last 3 folder names (adjust depth as needed)
      // Example: ["Test Folder", "2011 - 11 - 20 Chernobyl", "Reactor 1 - 4 Exterior"]
      const relevantParts = parts.slice(-3);
      
      // Extract keywords from all relevant folders
      const keywordSets = relevantParts.map(folder => this.extractKeywords(folder));
      
      // For backwards compatibility
      const currentFolder = parts[parts.length - 1] || '';
      const parentFolder = parts[parts.length - 2] || '';
      const primary = this.extractKeywords(parentFolder);
      const secondary = this.extractKeywords(currentFolder);

      // Combine all unique keywords from all levels
      const all = [...new Set(keywordSets.flat())];

      logger.debug('Keywords parsed', { 
        folderPath, 
        relevantFolders: relevantParts,
        primary, 
        secondary,
        all 
      });

      return {
        primary,
        secondary,
        all,
        hierarchical: relevantParts.map(p => p.trim())
      };

    } catch (error) {
      logger.error('Failed to parse keywords', { 
        folderPath, 
        error: error.message 
      });
      return {
        primary: [],
        secondary: [],
        all: [],
        hierarchical: []
      };
    }
  }

  /**
   * Extract keywords from a folder name
   * Strips dates, numbers, and cleans up the result
   * Intelligently handles ranges like "Reactor 1 - 4" and phrases like "Promethus Statue"
   */
  extractKeywords(folderName) {
    if (!folderName) return [];

    let cleaned = folderName;

    // Strip date patterns first
    for (const pattern of this.datePatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // Apply cleanup patterns
    for (const pattern of this.cleanupPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // Normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    // Skip if empty or too short
    if (!cleaned || cleaned.length < 2) {
      return [];
    }

    // NEW LOGIC: Intelligently split on delimiters
    // Pattern: "Reactor 1 - 4 Exterior" should become ["Reactor 1-4", "Exterior"]
    
    // First, split on major delimiters (comma, semicolon, pipe)
    const majorParts = cleaned.split(/[,;|]/);
    
    const keywords = [];
    
    majorParts.forEach(part => {
      part = part.trim();
      if (!part) return;
      
      // Check if this part contains "X - Y" pattern (range indicator)
      // Examples: "1 - 4", "Building A - C", "Reactor 1-4"
      const rangePattern = /^(.+?)\s*(\d+)\s*[-–]\s*(\d+)(.*)$/;
      const rangeMatch = part.match(rangePattern);
      
      if (rangeMatch) {
        // This is a range: "Reactor 1 - 4 Exterior"
        // Split into: prefix + range + suffix
        const prefix = rangeMatch[1].trim(); // "Reactor"
        const start = rangeMatch[2]; // "1"
        const end = rangeMatch[3]; // "4"
        const suffix = rangeMatch[4].trim(); // "Exterior"
        
        if (prefix) {
          // Combine prefix with range: "Reactor 1-4"
          keywords.push(`${prefix} ${start}-${end}`);
        }
        
        if (suffix) {
          // Add suffix as separate keyword: "Exterior"
          keywords.push(suffix);
        }
      } else {
        // No range pattern - split on spaces/hyphens but keep meaningful phrases
        // "Promethus Statue" should stay together if it's 2-3 words
        const words = part.split(/[\s_-]+/).filter(w => w.length > 1);
        
        if (words.length <= 3 && part.length <= 30) {
          // Short phrase - keep as single keyword
          keywords.push(part);
        } else {
          // Longer phrase - split into individual words
          keywords.push(...words.filter(w => {
            // Filter out pure numbers and single chars
            return w.length >= 2 && !/^\d+$/.test(w);
          }));
        }
      }
    });

    // Deduplicate and return
    return [...new Set(keywords)];
  }

  /**
   * Parse keywords relative to a base directory
   * Only extracts from folders BELOW the base, not above
   */
  parseKeywordsRelative(imageDirPath, baseDirPath) {
    try {
      // Get relative path from base to image directory
      const relativePath = path.relative(baseDirPath, imageDirPath);
      
      // Split into folder parts
      const folderParts = relativePath.split(path.sep).filter(p => p && p !== '.');
      
      // Also include the base folder name itself
      const baseFolderName = path.basename(baseDirPath);
      
      // Extract keywords from all levels: [base folder, ...subfolders]
      const allFolders = [baseFolderName, ...folderParts];
      
      const keywordSets = allFolders.map(folder => this.extractKeywords(folder));
      const all = [...new Set(keywordSets.flat())];
      
      logger.debug('Keywords parsed (relative)', { 
        baseDirPath,
        imageDirPath,
        relativePath,
        folders: allFolders,
        keywords: all
      });

      return {
        primary: this.extractKeywords(baseFolderName),
        secondary: folderParts.length > 0 ? this.extractKeywords(folderParts[folderParts.length - 1]) : [],
        all,
        hierarchical: allFolders
      };

    } catch (error) {
      logger.error('Failed to parse relative keywords', { 
        imageDirPath,
        baseDirPath,
        error: error.message 
      });
      return {
        primary: [],
        secondary: [],
        all: [],
        hierarchical: []
      };
    }
  }

  /**
   * Parse keywords from full path with multiple levels
   * Returns array of keyword sets from each folder level
   */
  parseHierarchy(folderPath) {
    try {
      const parts = folderPath.split(path.sep).filter(p => p);
      
      const hierarchy = parts.map((folder, index) => ({
        level: index,
        folder: folder,
        keywords: this.extractKeywords(folder)
      })).filter(item => item.keywords.length > 0);

      logger.debug('Hierarchy parsed', { folderPath, levels: hierarchy.length });

      return hierarchy;

    } catch (error) {
      logger.error('Failed to parse hierarchy', { 
        folderPath, 
        error: error.message 
      });
      return [];
    }
  }

  /**
   * Generate suggested keywords with confidence scores
   * Prioritizes deeper folder levels
   */
  getSuggestedKeywords(folderPath) {
    const hierarchy = this.parseHierarchy(folderPath);
    
    if (hierarchy.length === 0) {
      return [];
    }

    // Weight keywords based on depth (deeper = more specific = higher weight)
    const weighted = [];
    
    hierarchy.forEach((level, index) => {
      const weight = (index + 1) / hierarchy.length; // 0.33, 0.67, 1.0 for 3 levels
      
      level.keywords.forEach(keyword => {
        weighted.push({
          keyword: keyword.toLowerCase(),
          confidence: Math.round(weight * 100),
          source: level.folder
        });
      });
    });

    // Deduplicate, keeping highest confidence
    const unique = new Map();
    weighted.forEach(item => {
      if (!unique.has(item.keyword) || unique.get(item.keyword).confidence < item.confidence) {
        unique.set(item.keyword, item);
      }
    });

    // Sort by confidence (descending)
    const suggestions = Array.from(unique.values())
      .sort((a, b) => b.confidence - a.confidence);

    logger.debug('Suggested keywords generated', { 
      folderPath, 
      count: suggestions.length 
    });

    return suggestions;
  }

  /**
   * Format keywords for AI prompt
   * Returns comma-separated string
   */
  formatForPrompt(folderPath) {
    const { all } = this.parseKeywords(folderPath);
    return all.join(', ');
  }

  /**
   * Test cases for keyword extraction
   */
  static testExtraction() {
    const parser = new FolderKeywordParser();
    
    const testCases = [
      'Test Folder/2011 - 11 - 20 Chernobyl/Reactor 1 - 4 Exterior',
      'Test Folder/2011 - 11 - 20 Chernobyl/Promethus Statue',
      '2011_11_21_Chernobyl_Pripyat',
      '2011_11_21_Chernobyl_Pripyat/100 - Reactor 1-4 Exterior',
      '2011_09_21_Beer Glass',
      'YYYY-MM-DD/Project Name/Subfolder',
      '2023-05-15_Product_Photography',
      '20230515_Event_Photos'
    ];

    console.log('\n=== Folder Keyword Parser Tests ===\n');
    testCases.forEach(testCase => {
      const result = parser.parseKeywords(testCase);
      console.log(`Input: ${testCase}`);
      console.log(`Primary: [${result.primary.join(', ')}]`);
      console.log(`Secondary: [${result.secondary.join(', ')}]`);
      console.log(`All: [${result.all.join(', ')}]`);
      console.log(`Hierarchical: [${result.hierarchical.join(' > ')}]`);
      console.log('');
    });
  }
}

module.exports = FolderKeywordParser;


