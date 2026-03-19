// src/services/clipServiceManager.js
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const logger = require('../utils/logger');
const PathHelper = require('../utils/pathHelper');

class ClipServiceManager {
  constructor(progressCallback = null) {
    this.process = null;
    this.serviceUrl = 'http://127.0.0.1:8765';
    this.isStarting = false;
    this.isReady = false;
    this.progressCallback = progressCallback; // Callback to send progress updates to frontend
    this.setupStartTime = null; // Track setup start time
  }

  /**
   * Send setup progress update to frontend
   */
  sendSetupProgress(stage, message, percent, elapsedSeconds = null, remainingSeconds = null) {
    if (this.progressCallback) {
      this.progressCallback({
        type: 'clip-setup',
        stage: stage, // 'venv', 'deps', 'model', 'start'
        message: message,
        percent: percent,
        elapsedSeconds: elapsedSeconds,
        remainingSeconds: remainingSeconds
      });
    }
  }

  /**
   * Start the CLIP Python service
   */
  async start() {
    if (this.process || this.isStarting) {
      logger.info('CLIP service already starting or running');
      return;
    }

    this.isStarting = true;
    
    const scriptPath = PathHelper.getScriptPath('similarity_service.py');

    // Determine user runtime venv python path
    const venvPython = PathHelper.getPythonPath();

    // Bootstrap venv in userData if missing
    try {
      const userVenvDir = PathHelper.getUserVenvPath();
      logger.info('Checking Python virtual environment', { 
        venvDir: userVenvDir,
        venvPython: venvPython,
        venvExists: fs.existsSync(venvPython)
      });
      
      if (!fs.existsSync(venvPython)) {
        // First-time setup - start tracking time
        this.setupStartTime = Date.now();
        
        logger.info('User venv not found, bootstrapping...', { userVenvDir });
        this.sendSetupProgress('venv', 'Creating Python virtual environment...', 5);

        // Prefer system python3 from /usr/bin/python3; fallback to 'python3'
        const systemPythonCandidates = [
          '/usr/bin/python3',
          '/opt/homebrew/bin/python3',
          '/usr/local/bin/python3',
          'python3'
        ];
        const systemPython = systemPythonCandidates.find(p => {
          try { fs.accessSync(p, fs.constants.X_OK); return true; } catch { return false; }
        }) || 'python3';
        
        logger.info('Found system Python', { python: systemPython });

        // Create venv with better error handling
        logger.info('Creating Python virtual environment...');
        await new Promise((resolve, reject) => {
          const proc = spawn(systemPython, ['-m', 'venv', userVenvDir], { 
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 60000 // 60 second timeout
          });
          let stdout = '';
          let stderr = '';
          proc.stdout.on('data', d => stdout += d.toString());
          proc.stderr.on('data', d => stderr += d.toString());
          proc.on('close', code => {
            if (code === 0) {
              logger.info('✅ Virtual environment created successfully');
              const elapsed = Math.round((Date.now() - this.setupStartTime) / 1000);
              this.sendSetupProgress('venv', '✅ Virtual environment created successfully', 20, elapsed);
              resolve();
            } else {
              logger.error('Failed to create venv', { code, stderr: stderr.trim() });
              reject(new Error(`venv create failed (exit code ${code}): ${stderr.trim() || 'Unknown error'}`));
            }
          });
          proc.on('error', (error) => {
            logger.error('Error spawning venv creation', { error: error.message });
            reject(new Error(`Failed to spawn venv creation: ${error.message}`));
          });
        });

        // Upgrade pip with better error handling
        logger.info('Upgrading pip, wheel, setuptools...');
        this.sendSetupProgress('deps', 'Upgrading pip, wheel, setuptools...', 25);
        await new Promise((resolve, reject) => {
          const proc = spawn(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip', 'wheel', 'setuptools'], { 
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 120000 // 2 minute timeout
          });
          let stdout = '';
          let stderr = '';
          proc.stdout.on('data', d => stdout += d.toString());
          proc.stderr.on('data', d => stderr += d.toString());
          proc.on('close', code => {
            if (code === 0) {
              logger.info('✅ pip upgraded successfully');
              const elapsed = Math.round((Date.now() - this.setupStartTime) / 1000);
              this.sendSetupProgress('deps', '✅ pip upgraded successfully', 35, elapsed);
              resolve();
            } else {
              logger.error('Failed to upgrade pip', { code, stderr: stderr.trim() });
              reject(new Error(`pip upgrade failed (exit code ${code}): ${stderr.trim() || 'Unknown error'}`));
            }
          });
          proc.on('error', (error) => {
            logger.error('Error spawning pip upgrade', { error: error.message });
            reject(new Error(`Failed to spawn pip upgrade: ${error.message}`));
          });
        });

        // Install requirements from bundled file
        const reqPath = PathHelper.getRequirementsPath();
        logger.info('Checking for requirements.txt', { reqPath, exists: fs.existsSync(reqPath) });
        
        if (fs.existsSync(reqPath)) {
          logger.info('Installing CLIP service requirements from requirements.txt', { requirements: reqPath });
          this.sendSetupProgress('deps', 'Installing dependencies (this may take several minutes)...', 40);
          await new Promise((resolve, reject) => {
            // Use --upgrade to ensure all packages including new dependencies are installed
            // Use --upgrade-strategy eager to upgrade all dependencies, not just required ones
            const proc = spawn(venvPython, ['-m', 'pip', 'install', '-r', reqPath, '--upgrade', '--upgrade-strategy', 'eager'], { 
              stdio: ['ignore', 'pipe', 'pipe'],
              timeout: 600000 // 10 minute timeout for package installation
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', d => {
              const output = d.toString();
              stdout += output;
              // Log progress for long installations
              if (output.includes('Collecting') || output.includes('Installing')) {
                logger.info('[pip install]', { output: output.trim().split('\n').slice(-1)[0] });
                // Update progress - incrementally from 40% to 70% during dependency installation
                const progressLine = output.trim().split('\n').slice(-1)[0];
                const elapsed = Math.round((Date.now() - this.setupStartTime) / 1000);
                // Estimate progress based on elapsed time (dependencies usually take 1-3 minutes)
                const estimatedProgress = Math.min(40 + Math.floor((elapsed / 180) * 30), 70);
                this.sendSetupProgress('deps', `Installing: ${progressLine}`, estimatedProgress, elapsed);
              }
            });
            proc.stderr.on('data', d => stderr += d.toString());
            proc.on('close', async (code) => {
              if (code === 0) {
                logger.info('✅ Requirements installed successfully');
                
                // Verify critical packages are installed (torchvision is required for CLIPImageProcessorFast)
                logger.info('Verifying critical packages (torch, torchvision)...');
                this.sendSetupProgress('deps', 'Verifying installation...', 68);
                
                try {
                  // Check if torchvision is installed
                  const checkProc = spawn(venvPython, ['-c', 'import torchvision; print("torchvision OK")'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 10000
                  });
                  
                  await new Promise((checkResolve, checkReject) => {
                    let checkStdout = '';
                    let checkStderr = '';
                    checkProc.stdout.on('data', d => checkStdout += d.toString());
                    checkProc.stderr.on('data', d => checkStderr += d.toString());
                    checkProc.on('close', (checkCode) => {
                      if (checkCode === 0 && checkStdout.includes('torchvision OK')) {
                        logger.info('✅ torchvision verified');
                        checkResolve();
                      } else {
                        logger.warn('torchvision not found, attempting to install...', { 
                          code: checkCode, 
                          stderr: checkStderr.trim() 
                        });
                        // Install torchvision separately if missing
                        const installTorchvisionProc = spawn(venvPython, ['-m', 'pip', 'install', 'torchvision', '--upgrade'], {
                          stdio: ['ignore', 'pipe', 'pipe'],
                          timeout: 300000 // 5 minute timeout
                        });
                        installTorchvisionProc.on('close', (installCode) => {
                          if (installCode === 0) {
                            logger.info('✅ torchvision installed successfully');
                            checkResolve();
                          } else {
                            logger.error('Failed to install torchvision separately', { code: installCode });
                            checkReject(new Error('torchvision installation failed'));
                          }
                        });
                      }
                    });
                  });
                } catch (verifyError) {
                  logger.error('Package verification failed', { error: verifyError.message });
                  // Continue anyway - the service will fail with a clear error if torchvision is missing
                }
                
                const elapsed = Math.round((Date.now() - this.setupStartTime) / 1000);
                this.sendSetupProgress('deps', '✅ Dependencies installed successfully', 70, elapsed);
                resolve();
              } else {
                logger.error('Failed to install requirements', { code, stderr: stderr.trim().substring(0, 500) });
                reject(new Error(`requirements install failed (exit code ${code}): ${stderr.trim().substring(0, 500) || 'Unknown error'}`));
              }
            });
            proc.on('error', (error) => {
              logger.error('Error spawning pip install', { error: error.message });
              reject(new Error(`Failed to spawn pip install: ${error.message}`));
            });
          });
        } else {
          logger.warn('requirements.txt not found in resources; attempting online install of minimal deps');
          this.sendSetupProgress('deps', 'Installing dependencies (this may take several minutes)...', 40);
          await new Promise((resolve, reject) => {
            const pkgs = ['fastapi', 'uvicorn', 'transformers', 'torch', 'torchvision', 'torchaudio', 'pillow', 'numpy'];
            logger.info('Installing packages:', { packages: pkgs });
            const proc = spawn(venvPython, ['-m', 'pip', 'install', ...pkgs], { 
              stdio: ['ignore', 'pipe', 'pipe'],
              timeout: 600000 // 10 minute timeout
            });
            let stdout = '';
            let stderr = '';
            proc.stdout.on('data', d => stdout += d.toString());
            proc.stderr.on('data', d => stderr += d.toString());
            proc.on('close', code => {
              if (code === 0) {
                logger.info('✅ Packages installed successfully');
                const elapsed = Math.round((Date.now() - this.setupStartTime) / 1000);
                this.sendSetupProgress('deps', '✅ Dependencies installed successfully', 70, elapsed);
                resolve();
              } else {
                logger.error('Failed to install packages', { code, stderr: stderr.trim().substring(0, 500) });
                reject(new Error(`package install failed (exit code ${code}): ${stderr.trim().substring(0, 500) || 'Unknown error'}`));
              }
            });
            proc.on('error', (error) => {
              logger.error('Error spawning pip install', { error: error.message });
              reject(new Error(`Failed to spawn pip install: ${error.message}`));
            });
          });
        }
      } else {
        logger.info('✅ Virtual environment already exists');
        
        // Even if venv exists, verify critical packages are installed (especially torchvision)
        // This handles cases where venv was created before torchvision was added to requirements
        logger.info('Verifying critical packages in existing venv...');
        try {
          const checkProc = spawn(venvPython, ['-c', 'import torchvision; print("torchvision OK")'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 10000
          });
          
          await new Promise((checkResolve, checkReject) => {
            let checkStdout = '';
            let checkStderr = '';
            checkProc.stdout.on('data', d => checkStdout += d.toString());
            checkProc.stderr.on('data', d => checkStderr += d.toString());
            checkProc.on('close', async (checkCode) => {
              if (checkCode === 0 && checkStdout.includes('torchvision OK')) {
                logger.info('✅ All critical packages verified in existing venv');
                checkResolve();
              } else {
                logger.warn('Critical packages missing in existing venv, installing/upgrading...', { 
                  code: checkCode, 
                  stderr: checkStderr.trim() 
                });
                
                // Install/upgrade requirements to ensure all packages are present
                const reqPath = PathHelper.getRequirementsPath();
                if (fs.existsSync(reqPath)) {
                  logger.info('Upgrading requirements in existing venv...');
                  const upgradeProc = spawn(venvPython, ['-m', 'pip', 'install', '-r', reqPath, '--upgrade', '--upgrade-strategy', 'eager'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 600000 // 10 minute timeout
                  });
                  
                  let upgradeStdout = '';
                  let upgradeStderr = '';
                  upgradeProc.stdout.on('data', d => upgradeStdout += d.toString());
                  upgradeProc.stderr.on('data', d => upgradeStderr += d.toString());
                  upgradeProc.on('close', (upgradeCode) => {
                    if (upgradeCode === 0) {
                      logger.info('✅ Requirements upgraded successfully');
                      checkResolve();
                    } else {
                      logger.error('Failed to upgrade requirements', { code: upgradeCode, stderr: upgradeStderr.trim().substring(0, 500) });
                      checkReject(new Error(`Failed to upgrade requirements: ${upgradeStderr.trim().substring(0, 500)}`));
                    }
                  });
                  upgradeProc.on('error', (error) => {
                    logger.error('Error spawning pip upgrade', { error: error.message });
                    checkReject(new Error(`Failed to spawn pip upgrade: ${error.message}`));
                  });
                } else {
                  // Fallback: install torchvision directly
                  logger.info('Installing torchvision...');
                  const installProc = spawn(venvPython, ['-m', 'pip', 'install', 'torchvision', '--upgrade'], {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    timeout: 300000 // 5 minute timeout
                  });
                  installProc.on('close', (installCode) => {
                    if (installCode === 0) {
                      logger.info('✅ torchvision installed successfully');
                      checkResolve();
                    } else {
                      logger.error('Failed to install torchvision', { code: installCode });
                      checkReject(new Error('torchvision installation failed'));
                    }
                  });
                  installProc.on('error', (error) => {
                    logger.error('Error spawning torchvision install', { error: error.message });
                    checkReject(new Error(`Failed to spawn torchvision install: ${error.message}`));
                  });
                }
              }
            });
          });
        } catch (verifyError) {
          logger.error('Package verification failed', { error: verifyError.message });
          // Continue anyway - the service will fail with a clear error if packages are missing
        }
      }
    } catch (bootstrapError) {
      logger.error('Failed to bootstrap user venv', { 
        error: bootstrapError.message,
        stack: bootstrapError.stack
      });
      this.isStarting = false;
      throw new Error(`CLIP service setup failed: ${bootstrapError.message}. Check logs for details.`);
    }
    
    logger.info('Starting CLIP similarity service...', { 
      python: venvPython,
      script: scriptPath 
    });

    // If this is first-time setup (venv was just created), send progress
    const isFirstTimeSetup = this.setupStartTime !== null;
    if (isFirstTimeSetup) {
      this.sendSetupProgress('model', 'Downloading CLIP model (~890MB)...', 75);
    }

    try {
      // Capture stderr output for error diagnosis
      let errorOutput = '';
      let hasErrored = false;
      
      // Spawn Python process using venv Python with -u flag for unbuffered output
      // This ensures we get real-time logs from the Python service
      this.process = spawn(venvPython, ['-u', scriptPath], {
        cwd: PathHelper.getUserDataDir(),
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env } // Pass environment variables
      });

      // Log stdout
      this.process.stdout.on('data', (data) => {
        const output = data.toString();
        logger.info('[CLIP Service]', { output: output.trim() });
        
        // Check if service is ready
        if (output.includes('Uvicorn running')) {
          this.isReady = true;
          logger.info('CLIP service is ready');
          if (isFirstTimeSetup) {
            const elapsed = Math.round((Date.now() - this.setupStartTime) / 1000);
            this.sendSetupProgress('start', '✅ CLIP service started successfully', 100, elapsed);
            // Reset setup tracking
            this.setupStartTime = null;
          }
        }
        
        // Check if model is being downloaded (for first-time setup)
        if (isFirstTimeSetup && (output.includes('Downloading') || output.includes('Downloading model'))) {
          const elapsed = Math.round((Date.now() - this.setupStartTime) / 1000);
          this.sendSetupProgress('model', `Downloading CLIP model... (${elapsed}s elapsed)`, 80, elapsed);
        }
        
        // Check if model loading
        if (isFirstTimeSetup && (output.includes('Loading model') || output.includes('Model loaded'))) {
          const elapsed = Math.round((Date.now() - this.setupStartTime) / 1000);
          this.sendSetupProgress('model', 'Loading CLIP model...', 90, elapsed);
        }
      });

      // Log stderr (but filter out INFO messages that uvicorn sends to stderr)
      this.process.stderr.on('data', (data) => {
        const output = data.toString();
        errorOutput += output; // Capture all stderr for error diagnosis
        
        // Check if this is actually an error or just uvicorn server logs
        const isActualError = output.toLowerCase().includes('error') || 
                              output.toLowerCase().includes('exception') || 
                              output.toLowerCase().includes('traceback') ||
                              output.toLowerCase().includes('failed') ||
                              output.toLowerCase().includes('critical');
        const isInfoMessage = output.includes('INFO:') && (
          output.includes('Started server process') ||
          output.includes('Waiting for application startup') ||
          output.includes('Application startup complete') ||
          output.includes('Uvicorn running') ||
          output.includes('GET /health') ||
          output.includes('POST /')
        );
        
        if (isActualError && !isInfoMessage) {
          logger.error('[CLIP Service Error]', { error: output.trim() });
          hasErrored = true;
        } else {
          // Just INFO messages - log as info instead
          logger.info('[CLIP Service]', { output: output.trim() });
        }
      });

      // Handle process exit
      this.process.on('exit', (code, signal) => {
        logger.info('CLIP service exited', { code, signal });
        if (code !== 0 && code !== null) {
          logger.error('CLIP service exited with error code', { 
            code, 
            signal,
            errorOutput: errorOutput.trim().substring(0, 1000) // Last 1000 chars of error output
          });
          hasErrored = true;
        }
        this.process = null;
        this.isReady = false;
        this.isStarting = false;
      });

      // Handle process error
      this.process.on('error', (error) => {
        logger.error('Failed to spawn CLIP service process', { 
          error: error.message,
          python: venvPython,
          script: scriptPath
        });
        this.process = null;
        this.isReady = false;
        this.isStarting = false;
        hasErrored = true;
      });

      // Wait for service to be ready
      // First startup in packaged app may need to: create venv, install deps, download model (~890MB)
      // Use longer timeout for packaged apps (5 minutes), shorter for dev (30 seconds)
      // PathHelper is already imported at top of file
      const isPackaged = PathHelper.isPackaged();
      const timeout = isPackaged ? 300000 : 30000; // 5 minutes for packaged, 30 seconds for dev
      
      logger.info('Waiting for CLIP service to be ready', { 
        timeout: timeout / 1000 + ' seconds',
        isPackaged: isPackaged,
        python: venvPython,
        script: scriptPath
      });
      
      try {
        await this.waitForReady(timeout);
        
        // Double-check that service is actually ready
        if (hasErrored) {
          throw new Error('CLIP service process encountered errors during startup');
        }
        
        logger.info('CLIP service started successfully');
        this.isStarting = false;
      } catch (waitError) {
        // If service failed, include error output in the error message
        const errorDetails = errorOutput.trim() 
          ? `\n\nError details:\n${errorOutput.trim().substring(0, 1000)}`
          : '';
        
        logger.error('CLIP service failed to start', { 
          error: waitError.message,
          errorOutput: errorOutput.trim().substring(0, 1000),
          python: venvPython,
          script: scriptPath,
          scriptExists: fs.existsSync(scriptPath)
        });
        
        this.isStarting = false;
        throw new Error(`CLIP service failed to start: ${waitError.message}${errorDetails}`);
      }

    } catch (error) {
      logger.error('Error starting CLIP service', { error: error.message });
      this.isStarting = false;
      throw error;
    }
  }

  /**
   * Wait for service to be ready
   */
  async waitForReady(timeout = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      // Check if process is still running
      if (!this.process) {
        throw new Error('CLIP service process is not running');
      }
      
      // Check if process exited with error
      try {
        if (this.process.exitCode !== null && this.process.exitCode !== 0) {
          throw new Error(`CLIP service process exited with code ${this.process.exitCode}`);
        }
      } catch (error) {
        // exitCode might not be available yet, continue
      }
      
      try {
        const response = await Promise.race([
          axios.get(`${this.serviceUrl}/health`, { 
            timeout: 2000 
          }),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), 3000)
          )
        ]);
        
        if (response.status === 200) {
          this.isReady = true;
          return true;
        }
      } catch (error) {
        // Service not ready yet or health check timed out, wait and retry
        if (error.message === 'Health check timeout') {
          this.logger.warn('Health check timed out, retrying...');
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    // Check if process exited while we were waiting
    if (!this.process) {
      throw new Error('CLIP service process exited before becoming ready');
    }
    
    throw new Error(`CLIP service failed to start within ${timeout / 1000} seconds`);
  }

  /**
   * Check if service is running
   */
  async checkHealth() {
    // First check if process exists
    if (!this.process) {
      return false;
    }

    // Check if process is still alive
    try {
      // Check if process exited
      if (this.process.exitCode !== null) {
        this.logger.warn('CLIP service process has exited', { exitCode: this.process.exitCode });
        this.process = null;
        this.isReady = false;
        this.isStarting = false;
        return false;
      }
    } catch (error) {
      // Process might not have exitCode property yet
      // Continue to HTTP health check
    }

    // Check HTTP endpoint with timeout
    try {
      const response = await Promise.race([
        axios.get(`${this.serviceUrl}/health`, { 
          timeout: 2000 
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), 3000)
        )
      ]);
      
      if (response.status === 200) {
        this.isReady = true;
        return true;
      }
      return false;
    } catch (error) {
      // Health check failed or timed out - service not ready yet
      if (error.message === 'Health check timeout') {
        this.logger.warn('CLIP service health check timed out');
      }
      return false;
    }
  }

  /**
   * Stop the CLIP service
   */
  stop() {
    if (this.process) {
      logger.info('Stopping CLIP service...');
      this.process.kill('SIGTERM');
      this.process = null;
      this.isReady = false;
    }
  }

  /**
   * Restart the service
   */
  async restart() {
    this.stop();
    await new Promise(resolve => setTimeout(resolve, 2000));
    await this.start();
  }
}

module.exports = ClipServiceManager;


