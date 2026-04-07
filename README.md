# Lightroom XMP Metadata Generator

Local Electron app for AI-powered XMP metadata generation for Adobe Lightroom.

## Features

- **AI-Powered Analysis**: Uses Ollama (LLaVA) for local image analysis
- **Smart Grouping**: Detects similar images (RAW + derivatives) and applies metadata consistently
- **XMP Generation**: Creates proper XMP sidecar files for Lightroom Classic
- **Batch Processing**: Efficiently processes entire photo directories
- **Privacy-First**: All processing happens locally on your machine

## Prerequisites

- **Node.js**: v18 or higher
- **Ollama**: Running locally with LLaVA model
  ```bash
  # Install Ollama: https://ollama.ai
  ollama pull llava:latest
  ollama serve
  ```

## Installation

```bash
# Install dependencies
npm install

# Start the app in development mode
npm run dev

# Or run in production mode
npm start
```

## Project Structure

```
05 - Lightroom Meta Tagger/
├── src/
│   ├── main/              # Electron main process
│   ├── renderer/          # UI and renderer process
│   ├── services/          # Core business logic
│   ├── utils/             # Utility functions
│   └── config/            # Configuration files
├── tests/                 # Unit tests
├── test-images/           # Sample images for testing
├── temp/                  # Temporary processing files
├── z_Logs and traces/     # Application logs
└── config.json            # Main configuration
```

## Configuration

Edit `config.json` to customize:
- Ollama endpoint and model settings
- Processing batch size and parallel workers
- Image similarity thresholds
- XMP metadata options

## Development

```bash
# Run in development mode (opens DevTools)
npm run dev

# Run tests
npm test

# Verify setup
node scripts/verify-setup.js
```

## Protected Directories

The following directories are protected and should not be modified:
- `z_Logs and traces/` - For logging and debugging
- `z_VERSIONS/` - For version control
- `zz_Lightroom Meta Data Docs - DO NOT TOUCH/` - Reference documentation
- `zzz_CLAUDE/` - Claude-related files

## License

UNLICENSED - Private/Local Use Only

