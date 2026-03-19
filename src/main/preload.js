const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Directory selection
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  
  // Scanning
  scanDirectory: (dirPath) => ipcRenderer.invoke('scan-directory', dirPath),
  scanDirectoryWithClustering: (dirPath, threshold) => 
    ipcRenderer.invoke('scan-directory-with-clustering', dirPath, threshold),
  scanFilesWithClustering: (filePaths, threshold) => 
    ipcRenderer.invoke('scan-files-with-clustering', filePaths, threshold),
  
  // Processing (Phase 2)
  processImages: (scanResults, dirPath, skipClustering = false, clipValue = 95) => 
    ipcRenderer.invoke('process-images', scanResults, dirPath, skipClustering, clipValue),
  
  // Database
  getDatabasePath: () => ipcRenderer.invoke('get-database-path'),
  selectDatabaseLocation: () => ipcRenderer.invoke('select-database-location'),
  setDatabasePath: (dbPath) => ipcRenderer.invoke('set-database-path', dbPath),
  getDatabaseStats: () => ipcRenderer.invoke('get-database-stats'),
  clearDatabase: () => ipcRenderer.invoke('clear-database'),
  checkDatabaseStatus: () => ipcRenderer.invoke('check-database-status'),
  getProcessedImages: () => ipcRenderer.invoke('get-processed-images'),
  
  // Thumbnail retrieval
  getPreviewImage: (imagePath) => ipcRenderer.invoke('get-preview-image', imagePath),
  
  // Settings
  getAllSettings: () => ipcRenderer.invoke('get-all-settings'),
  
  // CLIP service management
  checkClipService: () => ipcRenderer.invoke('check-clip-service'),
  restartClipService: () => ipcRenderer.invoke('restart-clip-service'),
  
  // AI Settings
  saveAISettings: (settings) => ipcRenderer.invoke('save-ai-settings', settings),
  testGoogleVisionAPI: (apiKey) => ipcRenderer.invoke('test-google-vision-api', apiKey),
  testAiStudio: (apiKey) => ipcRenderer.invoke('test-ai-studio', apiKey),
  listAiStudioModels: (apiKey) => ipcRenderer.invoke('list-ai-studio-models', apiKey),
  
  // Personal Data
  getPersonalData: () => ipcRenderer.invoke('get-personal-data'),
  savePersonalData: (data) => ipcRenderer.invoke('save-personal-data', data),
  
  // AI Analysis
  analyzeClusterWithAI: (clusterGroup, customPrompt) => ipcRenderer.invoke('analyze-cluster-with-ai', clusterGroup, customPrompt),
  generateXMPFiles: (data) => ipcRenderer.invoke('generate-xmp-files', data),
  
  // External links
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  
  // Prompt Editor
  generateDefaultPrompt: (clusterGroup, promptStrategy) => ipcRenderer.invoke('generate-default-prompt', clusterGroup, promptStrategy),
  
  // File system helpers for drag & drop (via IPC to main process)
  isDirectory: (filePath) => ipcRenderer.invoke('is-directory', filePath),
  getParentDir: (filePath) => ipcRenderer.invoke('get-parent-dir', filePath),
  
  // Progress events
  onProgress: (callback) => {
    ipcRenderer.on('progress', (event, data) => callback(data));
  },
  
  // CLIP setup progress events
  onClipSetupProgress: (callback) => {
    ipcRenderer.on('clip-setup-progress', (event, data) => callback(data));
  },

  // Lightroom job listener
  onLightroomJobLoaded: (callback) => {
    ipcRenderer.on('lightroom-job-loaded', (event, data) => callback(data));
  },

  // Lightroom response writing
  writeLightroomResponse: (data) => ipcRenderer.invoke('write-lightroom-response', data)
});

