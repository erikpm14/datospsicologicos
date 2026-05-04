#!/usr/bin/env node
/**
 * EMERGENCY FFmpeg DEBUGGING
 * - Audita comando FFmpeg actual
 * - Ejecuta prueba mínima
 * - Identifica causa exacta del fallo
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { execSync, spawn } = require('child_process');
const logger = require('./src/utils/logger');

const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

const W = 1080;
const H = 1920;
const FPS = 30;

(async () => {
  try {
    logger.info('='.repeat(70));
    logger.info('EMERGENCY FFmpeg DEBUGGING');
    logger.info('='.repeat(70));

    // 1. Verificar ffmpeg path
    logger.info('\n[PATHS]');
    logger.info(`ffmpegInstaller.path: ${ffmpegInstaller.path}`);
    logger.info(`ffprobeInstaller.path: ${ffprobeInstaller.path}`);
    logger.info(`ffmpeg exists: ${fs.existsSync(ffmpegInstaller.path)}`);
    logger.info(`ffprobe exists: ${fs.existsSync(ffprobeInstaller.path)}`);

    // 2. Test simple ffmpeg call
    logger.info('\n[TEST 1] Simple FFmpeg version check');
    try {
      const versionOutput = execSync(`"${ffmpegInstaller.path}" -version`, { encoding: 'utf-8' }).split('\n')[0];
      logger.info(`✓ FFmpeg found: ${versionOutput}`);
    } catch (err) {
      logger.error(`✗ FFmpeg version check failed: ${err.message}`);
    }

    // 3. Crear prueba mínima: MP4 de 5s con color + sine wave audio
    logger.info('\n[TEST 2] Minimal FFmpeg render test (5s color + sine audio)');

    const testDir = path.join(__dirname, 'test-ffmpeg-debug');
    const testMp4 = path.join(testDir, 'test-minimal.mp4');

    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }

    // Limpiar archivo anterior
    if (fs.existsSync(testMp4)) {
      fs.unlinkSync(testMp4);
    }

    // Comando FFmpeg usando spawn (array de args, NO string con shell)
    logger.info(`Output file: ${testMp4}`);
    logger.info('Running: ffmpeg -f lavfi -i color=c=0a0e27:s=1080x1920:d=5 -f lavfi -i sine=f=440:d=5 -c:v libx264 -preset faster -crf 22 -c:a aac -b:a 128k -shortest -y output.mp4');

    const ffmpegProcess = spawn(ffmpegInstaller.path, [
      '-f', 'lavfi',
      '-i', 'color=c=0a0e27:s=1080x1920:d=5',
      '-f', 'lavfi',
      '-i', 'sine=f=440:d=5',
      '-c:v', 'libx264',
      '-preset', 'faster',
      '-crf', '22',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-shortest',
      '-y',
      testMp4
    ], { cwd: testDir, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });

    let ffmpegStdout = '';
    let ffmpegStderr = '';

    ffmpegProcess.stdout.on('data', (data) => {
      ffmpegStdout += data.toString();
    });

    ffmpegProcess.stderr.on('data', (data) => {
      ffmpegStderr += data.toString();
    });

    await new Promise((resolve, reject) => {
      ffmpegProcess.on('close', (code) => {
        if (code === 0) {
          logger.info(`✓ FFmpeg process completed with code ${code}`);
        } else {
          logger.error(`✗ FFmpeg process failed with code ${code}`);
        }

        logger.info(`\n[STDERR OUTPUT (last 500 chars)]`);
        const stderrTail = ffmpegStderr.slice(-500);
        logger.info(stderrTail);

        resolve();
      });

      ffmpegProcess.on('error', (err) => {
        logger.error(`✗ FFmpeg process error: ${err.message}`);
        reject(err);
      });
    });

    // 4. Validar resultado
    logger.info('\n[VALIDATION]');
    if (!fs.existsSync(testMp4)) {
      logger.error('✗ MP4 file not created!');
    } else {
      const stats = fs.statSync(testMp4);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(3);
      logger.info(`✓ MP4 file created: ${sizeMB}MB (${stats.size} bytes)`);

      if (stats.size < 100 * 1024) {
        logger.error(`✗ INVALID: File too small (${sizeMB}MB, expected >0.1MB)`);
      } else {
        logger.info(`✓ File size acceptable`);

        // 5. Check with ffprobe
        logger.info('\n[FFPROBE CHECK]');
        try {
          const ffprobeCmd = `"${ffprobeInstaller.path}" -v error -show_entries format=duration,bit_rate,size -of default=noprint_wrappers=1:nokey=1 "${testMp4}"`;
          logger.info(`Running: ffprobe -v error -show_entries format=duration,bit_rate,size -of default=noprint_wrappers=1:nokey=1 "${testMp4}"`);
          const ffprobeOutput = execSync(ffprobeCmd, { encoding: 'utf-8' });
          const lines = ffprobeOutput.split('\n').filter(l => l.trim());
          logger.info(`ffprobe output:\n${lines.join('\n')}`);

          if (lines.length > 0) {
            const duration = parseFloat(lines[0]);
            logger.info(`✓ Duration: ${duration.toFixed(2)}s`);
            if (duration < 4) {
              logger.error(`✗ Duration too short (${duration.toFixed(2)}s, expected ~5s)`);
            }
          }
        } catch (err) {
          logger.error(`⚠ ffprobe failed: ${err.message}`);
        }
      }
    }

    // 6. Analizar comando actual en hyperframe-renderer.js
    logger.info('\n[CURRENT HYPERFRAME COMMAND]');
    const audioDuration = 36.94; // Desde el log anterior
    const durationStr = Math.ceil(audioDuration).toString();
    const vf = `fps=${FPS}`;
    const fakeAudioPath = 'C:\\\\path\\\\to\\\\audio.mp3';
    const fakeOutputPath = 'C:\\\\path\\\\to\\\\output.mp4';

    const currentCmd = [
      `"${ffmpegInstaller.path}"`,
      `-f lavfi -i color=c=0a0e27:s=${W}x${H}:d=${durationStr}`,
      `-i "${fakeAudioPath}"`,
      `-vf "${vf}"`,
      `-map 0:v -map 1:a`,
      `-c:v libx264 -preset faster -crf 22`,
      `-c:a aac -b:a 128k`,
      `-shortest`,
      `-y`,
      `"${fakeOutputPath}"`,
    ].join(' ');

    logger.info('Current command (string-based with shell):');
    logger.info(currentCmd);

    logger.info('\n' + '='.repeat(70));
    logger.info('DIAGNOSIS COMPLETE');
    logger.info('='.repeat(70));

  } catch (err) {
    logger.error(`\n[FATAL] ${err.message}`);
    process.exit(1);
  }
})();
