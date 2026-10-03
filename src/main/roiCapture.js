/**
 * Python ROI Capture Manager
 * Spawns and manages a Python child process for fast screen region capture
 */
const { spawn } = require('child_process');
const path = require('path');

class ROICaptureManager {
  constructor() {
    this.pythonProcess = null;
    this.isReady = false;
    this.pendingCallbacks = new Map();
    this.callbackId = 0;
    this.outputBuffer = ''; // Buffer for incomplete JSON lines
  }

  /**
   * Start the Python capture process
   */
  start() {
    return new Promise((resolve, reject) => {
      const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'capture_roi.py');
      
      console.log('[ROI Capture] Starting Python process:', scriptPath);
      
      // Spawn Python process with unbuffered I/O
      this.pythonProcess = spawn('python', ['-u', scriptPath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      console.log('[ROI Capture] Python process spawned, PID:', this.pythonProcess.pid);

      // Handle stdout (capture data) with proper buffering for large JSON
      this.pythonProcess.stdout.on('data', (data) => {
        try {
          // Append new data to buffer
          this.outputBuffer += data.toString();
          
          // Process complete lines (ending with \n)
          let newlineIndex;
          while ((newlineIndex = this.outputBuffer.indexOf('\n')) !== -1) {
            const line = this.outputBuffer.substring(0, newlineIndex).trim();
            this.outputBuffer = this.outputBuffer.substring(newlineIndex + 1);
            
            if (line.length > 0) {
              try {
                const result = JSON.parse(line);
                this.handleResult(result);
              } catch (parseErr) {
                console.error('[ROI Capture] Failed to parse JSON line:', parseErr.message);
                console.error('[ROI Capture] Line length:', line.length, 'First 100 chars:', line.substring(0, 100));
              }
            }
          }
        } catch (err) {
          console.error('[ROI Capture] stdout error:', err);
        }
      });

      // Handle stderr (errors)
      this.pythonProcess.stderr.on('data', (data) => {
        console.error('[ROI Capture] Python error:', data.toString());
      });

      // Handle process exit
      this.pythonProcess.on('exit', (code) => {
        console.log(`[ROI Capture] Python process exited with code ${code}`);
        this.isReady = false;
      });
      
      // Handle spawn error
      this.pythonProcess.on('error', (err) => {
        console.error('[ROI Capture] Failed to spawn Python:', err);
        reject(err);
      });

      // Test with ping
      setTimeout(() => {
        console.log('[ROI Capture] Sending ping test...');
        this.sendCommand({ action: 'ping' })
          .then(() => {
            console.log('[ROI Capture] Ping successful, ready!');
            this.isReady = true;
            resolve();
          })
          .catch((err) => {
            console.error('[ROI Capture] Ping failed:', err);
            reject(err);
          });
      }, 500);
    });
  }

  /**
   * Send command to Python process
   */
  sendCommand(command) {
    return new Promise((resolve, reject) => {
      if (!this.pythonProcess) {
        return reject(new Error('Python process not started'));
      }

      const id = this.callbackId++;
      this.pendingCallbacks.set(id, { resolve, reject });
      
      const commandWithId = { ...command, _id: id };
      this.pythonProcess.stdin.write(JSON.stringify(commandWithId) + '\n');
      
      // Timeout after 5 seconds
      setTimeout(() => {
        if (this.pendingCallbacks.has(id)) {
          this.pendingCallbacks.delete(id);
          reject(new Error('Command timeout'));
        }
      }, 5000);
    });
  }

  /**
   * Handle result from Python
   */
  handleResult(result) {
    const id = result._id;
    if (id !== undefined && this.pendingCallbacks.has(id)) {
      const { resolve, reject } = this.pendingCallbacks.get(id);
      this.pendingCallbacks.delete(id);
      
      if (result.success) {
        resolve(result);
      } else {
        reject(new Error(result.error || 'Unknown error'));
      }
    }
  }

  /**
   * Capture a screen region
   */
  async captureRegion(monitor, x, y, width, height, resizeWidth, resizeHeight) {
    if (!this.isReady) {
      throw new Error('Python capture not ready');
    }

    const result = await this.sendCommand({
      action: 'capture',
      monitor,
      x,
      y,
      width,
      height,
      resizeWidth,
      resizeHeight
    });

    return result;
  }

  /**
   * Stop the Python process
   */
  stop() {
    if (this.pythonProcess) {
      this.sendCommand({ action: 'exit' }).catch(() => {});
      setTimeout(() => {
        if (this.pythonProcess) {
          this.pythonProcess.kill();
        }
      }, 1000);
    }
    this.isReady = false;
    this.outputBuffer = ''; // Clear buffer
    this.pendingCallbacks.clear();
  }
}

module.exports = ROICaptureManager;
