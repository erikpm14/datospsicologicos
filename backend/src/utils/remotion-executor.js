/**
 * remotion-executor.js
 *
 * Resolve and execute Remotion CLI robustly on Windows/Unix
 * Handles local node_modules/.bin/remotion first, falls back to npm exec
 */

const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const logger = require('./logger');

const execFileAsync = promisify(execFile);

/**
 * Resolve Remotion executable path
 * Windows: remotion-video/node_modules/.bin/remotion.cmd
 * Unix: remotion-video/node_modules/.bin/remotion
 *
 * @param {string} remotionProjectDir - Absolute path to remotion-video directory
 * @returns {string} Absolute path to remotion executable
 * @throws {Error} If remotion binary not found
 */
function resolveRemotionExecutable(remotionProjectDir) {
  // Always use npm exec for maximum compatibility across platforms
  // npm exec handles .cmd files, shebangs, and shell interpretation correctly
  // This avoids spawn EINVAL errors on Windows with .cmd files
  logger.debug(`[remotion-executor] remotionProjectDir=${remotionProjectDir}`);
  const binDir = path.join(remotionProjectDir, 'node_modules', '.bin');
  const executablePath = path.join(binDir, 'remotion');

  // Just verify that remotion is installed
  if (!fs.existsSync(executablePath) && !fs.existsSync(executablePath + '.cmd')) {
    throw new Error(
      `Remotion CLI not found at ${binDir}. ` +
      `Run: cd ${remotionProjectDir} && npm install`
    );
  }

  logger.info(`[remotion-executor] Remotion found in ${binDir}`);
  // Return marker to indicate we should use npm exec
  return 'use-npm-exec';
}

/**
 * Get npm command - always use 'npm' which relies on PATH
 * Node.js resolves this correctly through the system
 */
function getNpmCommand() {
  const isWindows = process.platform === 'win32';
  // Always return 'npm' - Windows and Unix both handle this through PATH correctly
  // when using spawn with shell: true for Windows
  return isWindows ? 'npm.cmd' : 'npm';
}

/**
 * Execute Remotion render command via npm exec
 * Uses npm exec for maximum compatibility on Windows and Unix
 *
 * @param {string} remotionProjectDir - Absolute path to remotion-video directory
 * @param {Array<string>} cmdArgs - Command arguments (e.g., ['render', projectRoot, compositionId, outputPath, ...])
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} { stdout, stderr }
 */
async function executeRemotionRender(remotionProjectDir, cmdArgs, options = {}) {
  const {
    timeout = 300000,
  } = options;

  logger.info(`[remotion-executor] CWD: ${remotionProjectDir}`);
  logger.debug(`[remotion-executor] Args: ${cmdArgs.join(' ')}`);

  // Verify remotion is installed
  resolveRemotionExecutable(remotionProjectDir);

  // Always use npm exec: it handles .cmd files, shebangs, and cross-platform execution correctly
  logger.debug(`[remotion-executor] Using npm exec for Remotion CLI execution`);

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let finished = false;

    try {
      const isWindows = process.platform === 'win32';
      const npmCmd = getNpmCommand();
      const npmExecArgs = ['exec', '--', 'remotion', ...cmdArgs];

      logger.debug(`[remotion-executor] npm command: ${npmCmd}`);
      logger.debug(`[remotion-executor] npm args: ${npmExecArgs.join(' ')}`);

      const childProcess = spawn(npmCmd, npmExecArgs, {
        cwd: remotionProjectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: isWindows,  // Use shell on Windows for npm.cmd execution
        env: process.env
      });

      let out = '';
      let err = '';

      childProcess.stdout.on('data', (d) => out += d.toString());
      childProcess.stderr.on('data', (d) => err += d.toString());

      childProcess.on('error', (error) => {
        if (!finished) {
          finished = true;
          reject(error);
        }
      });

      childProcess.on('close', (code) => {
        if (!finished) {
          finished = true;
          if (code === 0) {
            resolve({ stdout: out, stderr: err });
          } else {
            if (err) {
              logger.error(`[remotion-executor] Remotion stderr:\n${err}`);
            }
            const error = new Error(`Remotion exited with code ${code}`);
            error.code = code;
            error.stderr = err;
            reject(error);
          }
        }
      });

      const timeoutHandle = setTimeout(() => {
        if (!finished) {
          finished = true;
          childProcess.kill();
          const error = new Error(`Process timeout after ${timeout}ms`);
          error.code = 'ETIMEDOUT';
          reject(error);
        }
      }, timeout);

      childProcess.on('close', () => clearTimeout(timeoutHandle));
    } catch (error) {
      logger.error(`[remotion-executor] Setup failed: ${error.message}`);
      if (!finished) {
        finished = true;
        reject(error);
      }
    }
  }).then(result => {
    if (result.stdout) {
      logger.debug(`[remotion-executor] stdout: ${result.stdout.substring(0, 300)}`);
    }
    if (result.stderr) {
      logger.debug(`[remotion-executor] stderr: ${result.stderr.substring(0, 300)}`);
    }
    return result;
  }).catch(error => {
    let errorHint = '';

    if (error.code === 'ENOENT') {
      errorHint = `\nHint: npm or Remotion not found. Run: cd ${remotionProjectDir} && npm install`;
    } else if (error.code === 'ETIMEDOUT') {
      errorHint = `\nHint: Render timeout after ${timeout}ms. Try increasing REMOTION_TIMEOUT.`;
    }

    logger.error(`[remotion-executor] Execution failed: ${error.message}${errorHint}`);

    const enrichedError = new Error(`Remotion render failed: ${error.message}${errorHint}`);
    enrichedError.code = error.code;
    if (error && error.stderr) {
      enrichedError.stderr = error.stderr;
    }

    throw enrichedError;
  });
}

module.exports = {
  resolveRemotionExecutable,
  executeRemotionRender,
};
