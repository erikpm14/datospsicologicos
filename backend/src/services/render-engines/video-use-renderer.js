/**
 * video-use-renderer.js
 * Adaptador para renderizar vídeos con video-use (Python).
 *
 * Convierte script JSON → entrada video-use → ejecuta Python → retorna video.
 * Si VIDEO_USE_ENABLED=false, falla gracefully al motor actual.
 */

require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const VIDEO_USE_ENABLED = process.env.VIDEO_USE_ENABLED === 'true';
const VIDEO_USE_DRY_RUN = process.env.VIDEO_USE_DRY_RUN === 'true';
const VIDEO_USE_OUTPUT_DIR = process.env.VIDEO_USE_OUTPUT_DIR || './output/video-use';
const VIDEO_USE_STYLE = process.env.VIDEO_USE_STYLE || 'viral_psychology_short';
const VIDEO_USE_REPO_PATH = path.resolve(process.env.VIDEO_USE_REPO_PATH || './integrations/video-use');
const PYTHON_BIN = process.env.PYTHON_BIN_VIDEO_USE || 'python3';

/**
 * Convierte script JSON a formato video-use
 */
function buildVideoUseInput(script, audioPath, outputPath) {
  const segments = [];
  const segmentKeys = ['hook', 'open_loop', 'micro_value', 'escalation', 'reengage', 'peak', 'open_ending', 'soft_cta'];

  for (const key of segmentKeys) {
    if (script[key]) {
      segments.push({
        type: key.toUpperCase(),
        text: script[key],
        emotion: script.emotionalTrigger || 'neutral',
        visualIntent: script.effectName || key,
      });
    }
  }

  return {
    title: script.title || 'untitled',
    audioPath: audioPath,
    outputPath: outputPath,
    skillStyle: VIDEO_USE_STYLE,
    dryRun: VIDEO_USE_DRY_RUN,
    segments: segments,
    metadata: {
      topic: script.topic,
      effectName: script.effectName,
      psychologicalFact: script.psychologicalFact,
      viralTrigger: script.viralTrigger,
      emotionalTrigger: script.emotionalTrigger,
      keywords: script.keywords || [],
    },
    config: {
      minDuration: 45,
      maxDuration: 65,
      subtitleMaxWords: 4,
      audioFadeMs: 30,
      silenceThresholdMs: 150,
      fillerWordRemoval: true,
    },
  };
}

/**
 * Ejecuta video-use como child process Python
 */
function executeVideoUseProcess(inputConfig) {
  return new Promise((resolve, reject) => {
    // Script Python que ejecutará video-use
    const pythonScript = path.join(VIDEO_USE_REPO_PATH, 'cli.py');

    if (!fs.existsSync(pythonScript)) {
      return reject(new Error(`video-use CLI not found at ${pythonScript}. Clone the repo first.`));
    }

    // Pasar configuración como JSON en stdin
    const inputJson = JSON.stringify(inputConfig);

    logger.info(`[video-use] Spawning Python process | style=${VIDEO_USE_STYLE} | dry_run=${VIDEO_USE_DRY_RUN}`);

    const proc = spawn(PYTHON_BIN, [pythonScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: VIDEO_USE_REPO_PATH,
      env: {
        ...process.env,
        VIDEO_USE_SKILL_STYLE: VIDEO_USE_STYLE,
        VIDEO_USE_DRY_RUN: String(VIDEO_USE_DRY_RUN),
        ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY || '',
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      logger.info(`[video-use] ${data.toString().trim()}`);
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      logger.warn(`[video-use] ${data.toString().trim()}`);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        logger.info(`[video-use] Process completed | output=${inputConfig.outputPath}`);
        resolve({ outputPath: inputConfig.outputPath, stdout, stderr });
      } else {
        logger.error(`[video-use] Process failed (exit code ${code})`);
        reject(new Error(`video-use exited with code ${code}: ${stderr}`));
      }
    });

    proc.on('error', (err) => {
      logger.error(`[video-use] Spawn error: ${err.message}`);
      reject(err);
    });

    // Enviar configuración JSON por stdin
    proc.stdin.write(inputJson);
    proc.stdin.end();
  });
}

/**
 * Renderiza vídeo con video-use
 * Retorna { success: boolean, videoPath: string, error?: string }
 */
async function renderWithVideoUse(options = {}) {
  if (!VIDEO_USE_ENABLED) {
    throw new Error('VIDEO_USE_ENABLED is false. Use VIDEO_RENDER_ENGINE=video_use to enable.');
  }

  const { script, audioPath, outputPath } = options;

  if (!script) throw new Error('script is required');
  if (!audioPath || !fs.existsSync(audioPath)) throw new Error(`audioPath not found: ${audioPath}`);
  if (!outputPath) throw new Error('outputPath is required');

  // Crear directorio de salida si no existe
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Construir entrada para video-use
  const inputConfig = buildVideoUseInput(script, audioPath, outputPath);

  logger.info(`[video-use-renderer] Starting render | script=${script.title} | dry_run=${VIDEO_USE_DRY_RUN}`);

  try {
    const result = await executeVideoUseProcess(inputConfig);

    // Verificar que el vídeo se generó
    if (!fs.existsSync(outputPath)) {
      throw new Error(`Output file not created at ${outputPath}`);
    }

    const stats = fs.statSync(outputPath);
    logger.info(`[video-use-renderer] Render complete | size=${Math.round(stats.size / 1024 / 1024)}MB`);

    return {
      success: true,
      videoPath: outputPath,
      dryRun: VIDEO_USE_DRY_RUN,
    };
  } catch (error) {
    logger.error(`[video-use-renderer] Failed: ${error.message}`);
    throw error;
  }
}

/**
 * Health check: verifica si video-use está disponible
 */
async function checkVideoUseAvailability() {
  return new Promise((resolve) => {
    const proc = spawn(PYTHON_BIN, ['-c', 'import video_use; print("OK")'], {
      timeout: 5000,
    });

    let output = '';
    proc.stdout.on('data', (data) => (output += data.toString()));
    proc.on('close', (code) => {
      resolve(code === 0 && output.includes('OK'));
    });
    proc.on('error', () => resolve(false));

    setTimeout(() => {
      proc.kill();
      resolve(false);
    }, 5000);
  });
}

module.exports = {
  renderWithVideoUse,
  checkVideoUseAvailability,
  buildVideoUseInput,
};
