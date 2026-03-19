const winston = require('winston');
const fs = require('fs');
const path = require('path');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level.toUpperCase()}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
  ),
  transports: [
    // Console transport - always enabled
    new winston.transports.Console({
      level: 'info',
      format: winston.format.colorize({ all: true })
    }),
  ]
});

// Add file transport to the requested directory
try {
  const logsDir = '/Volumes/ATOM RAID/Dropbox/_Personal Files/12 - AI Vibe Coding/02 - Cursor Projects/05 - Lightroom Meta Tagger/z_Logs and traces';
  // Ensure directory exists
  fs.mkdirSync(logsDir, { recursive: true });
  const logFilePath = path.join(logsDir, 'app.log');
  logger.add(new winston.transports.File({ filename: logFilePath, level: 'info' }));
} catch (error) {
  // Fall back silently to console-only if directory is unavailable
  // Avoid throwing during logger initialization
}

module.exports = logger;

