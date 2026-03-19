// src/utils/systemCheck.js
const { execFile } = require('child_process');
const { promisify } = require('util');
const logger = require('./logger');
const PathHelper = require('./pathHelper');

const execFileAsync = promisify(execFile);

class SystemCheck {
  async checkAll() {
    const results = {
      exiftool: await this.checkExiftool(),    // REQUIRED
      sharp: await this.checkSharp(),          // REQUIRED
      imghash: await this.checkImghash(),      // REQUIRED
      database: await this.checkDatabase()     // REQUIRED
      // dcraw is OPTIONAL - removed from checks to avoid confusion
    };

    // Only fail if REQUIRED tools are missing
    const requiredTools = ['exiftool', 'sharp', 'imghash', 'database'];
    const allPassed = requiredTools.every(tool => results[tool].available);
    
    // Check dcraw separately (optional)
    const dcrawResult = await this.checkDcraw();
    results.dcraw = dcrawResult;
    
    // Build warnings list
    const warnings = [];
    if (!dcrawResult.available) {
      warnings.push('dcraw not installed - some old CR2 files may fail to process');
    }

    // Log system info for reference (not a warning)
    const os = require('os');
    const totalRAM = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const freeRAM = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
    
    logger.info('System check complete', { 
      results,
      allPassed,
      warnings,
      systemInfo: {
        platform: os.platform(),
        arch: os.arch(),
        totalRAM: `${totalRAM}GB`,
        freeRAM: `${freeRAM}GB (note: macOS aggressively caches, actual available is higher)`,
        cpus: os.cpus().length
      }
    });

    return { allPassed, results, warnings };
  }

  async checkExiftool() {
    try {
      const exiftoolPath = PathHelper.getExiftoolPath();
      const { stdout } = await execFileAsync(exiftoolPath, ['-ver']);
      const version = stdout.trim();
      return { 
        available: true, 
        version,
        message: `exiftool ${version} available` 
      };
    } catch (error) {
      return { 
        available: false, 
        message: 'exiftool not found - required for metadata extraction',
        installCommand: 'brew install exiftool'
      };
    }
  }

  async checkDcraw() {
    const fs = require('fs');
    
    try {
      const { app } = require('electron');
      if (app.isPackaged) {
        // Packaged app - check for bundled dcraw
        const dcrawPath = PathHelper.getDcrawPath();
        if (fs.existsSync(dcrawPath)) {
          return { 
            available: true, 
            message: 'dcraw available for old CR2 files' 
          };
        }
        return { 
          available: false, 
          message: 'dcraw not installed (optional)',
          installCommand: 'brew install dcraw'
        };
      } else {
        // Development - check system dcraw
        const { execSync } = require('child_process');
        try {
          execSync('which dcraw', { stdio: 'ignore' });
          return { 
            available: true, 
            message: 'dcraw available for old CR2 files' 
          };
        } catch {
          return { 
            available: false, 
            message: 'dcraw not installed (optional)',
            installCommand: 'brew install dcraw'
          };
        }
      }
    } catch {
      // Not in Electron context, try system check
      try {
        const { execSync } = require('child_process');
        execSync('which dcraw', { stdio: 'ignore' });
        return { 
          available: true, 
          message: 'dcraw available for old CR2 files' 
        };
      } catch {
        return { 
          available: false, 
          message: 'dcraw not installed (optional)',
          installCommand: 'brew install dcraw'
        };
      }
    }
  }

  async checkSharp() {
    try {
      const sharp = require('sharp');
      const version = sharp.versions;
      return { 
        available: true, 
        version: version.sharp,
        message: `sharp ${version.sharp} available` 
      };
    } catch (error) {
      return { 
        available: false, 
        message: 'sharp module not installed',
        installCommand: 'npm install sharp'
      };
    }
  }

  async checkImghash() {
    try {
      require('imghash');
      return { 
        available: true, 
        message: 'imghash module available' 
      };
    } catch (error) {
      return { 
        available: false, 
        message: 'imghash module not installed',
        installCommand: 'npm install imghash'
      };
    }
  }

  async checkDatabase() {
    try {
      require('better-sqlite3');
      return { 
        available: true, 
        message: 'better-sqlite3 available' 
      };
    } catch (error) {
      return { 
        available: false, 
        message: 'better-sqlite3 not installed',
        installCommand: 'npm install better-sqlite3'
      };
    }
  }
}

module.exports = SystemCheck;