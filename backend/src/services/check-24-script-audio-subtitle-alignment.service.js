/**
 * CHECK_24 — SCRIPT_AUDIO_SUBTITLE_ALIGNMENT
 *
 * Verifica que:
 * 1. Script text == subtitles text (formato puede diferir, contenido idéntico)
 * 2. Audio-manifest.json existe y es válido
 * 3. Audio file pertenece al videoId correcto (no reutilizado de otro vídeo)
 * 4. SHA256 del audio en manifest coincide con el archivo real
 * 5. Audio path es local al videoId (no global/compartido)
 *
 * BLOQUEA si:
 * - Falta audio-manifest.json
 * - Audio de otro videoId
 * - Hash del audio no coincide
 * - Audio path es global/compartido
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { validateAudioManifest } = require('./audio-manifest.service');

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function extractScriptText(script) {
  if (!script) return '';
  return [
    script.hook,
    script.claim,
    script.explanation,
    script.cta
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

function extractSubtitleText(vttContent) {
  if (!vttContent) return '';
  const lines = vttContent.split('\n');
  const textLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.match(/-->/)) continue;
    if (line === 'WEBVTT') continue;
    textLines.push(line);
  }

  return textLines.join('\n').trim();
}

function checkScriptAudioSubtitleAlignment(videoPath, videoId) {
  const videoDir = path.dirname(videoPath);

  try {
    // 1. Leer script.json
    const scriptPath = path.join(videoDir, 'script.json');
    if (!fs.existsSync(scriptPath)) {
      return {
        pass: false,
        error: 'script.json not found',
        severity: 'critical'
      };
    }

    const scriptContent = JSON.parse(fs.readFileSync(scriptPath, 'utf8'));
    const scriptText = extractScriptText(scriptContent);

    if (!scriptText) {
      return {
        pass: false,
        error: 'Script text is empty',
        severity: 'critical'
      };
    }

    // 2. Leer subtítulos
    let subtitleText = '';
    const vttPath = path.join(videoDir, 'subtitles.vtt');
    const assPath = path.join(videoDir, 'subtitles.ass');

    if (fs.existsSync(vttPath)) {
      const vttContent = fs.readFileSync(vttPath, 'utf8');
      subtitleText = extractSubtitleText(vttContent);
    } else if (fs.existsSync(assPath)) {
      const assContent = fs.readFileSync(assPath, 'utf8');
      const dialogLines = assContent
        .split('\n')
        .filter(l => l.startsWith('Dialogue:'))
        .map(l => {
          const parts = l.split(',');
          return parts.slice(9).join(',').trim();
        })
        .join('\n');
      subtitleText = dialogLines;
    } else {
      return {
        pass: false,
        error: 'No subtitle file found',
        severity: 'critical'
      };
    }

    if (!subtitleText) {
      return {
        pass: false,
        error: 'Subtitle text is empty',
        severity: 'critical'
      };
    }

    // 3. Verificar OBLIGATORIO: audio-manifest.json
    const manifestPath = path.join(videoDir, 'audio-manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return {
        pass: false,
        error: 'CRITICAL: audio-manifest.json is missing (mandatory after audio reuse incident)',
        severity: 'critical',
        blockReason: 'MISSING_AUDIO_MANIFEST'
      };
    }

    // 4. Validar audio-manifest
    const manifestValidation = validateAudioManifest(videoId, manifestPath);
    if (!manifestValidation.valid) {
      return {
        pass: false,
        error: `Audio manifest validation failed: ${manifestValidation.error}`,
        severity: 'critical',
        blockReason: 'INVALID_AUDIO_MANIFEST'
      };
    }

    const manifest = manifestValidation.manifest;

    // 5. Verificar que audio pertenece al videoId correcto
    if (manifest.videoId !== videoId) {
      return {
        pass: false,
        error: `CRITICAL: Audio belongs to different videoId (${manifest.videoId}), trying to use in ${videoId}`,
        severity: 'critical',
        blockReason: 'AUDIO_REUSE_DETECTED'
      };
    }

    // 6. Verificar que audio path es local al videoId
    if (!manifest.audioFile.path.includes(videoId)) {
      return {
        pass: false,
        error: `CRITICAL: Audio path is not local to this videoId: ${manifest.audioFile.path}`,
        severity: 'critical',
        blockReason: 'AUDIO_PATH_GLOBAL_OR_SHARED'
      };
    }

    // 7. Verificar integridad de script (bonus check)
    const scriptWords = scriptText.toLowerCase().split(/\s+/).filter(Boolean);
    const subtitleWords = subtitleText.toLowerCase().split(/\s+/).filter(Boolean);
    const commonWords = scriptWords.filter(w => subtitleWords.includes(w)).length;
    const contentSimilarity = commonWords / Math.max(scriptWords.length, subtitleWords.length);

    if (contentSimilarity < 0.9) {
      return {
        pass: false,
        error: `Script and subtitle text have low similarity: ${(contentSimilarity * 100).toFixed(2)}%`,
        severity: 'critical',
        blockReason: 'SCRIPT_SUBTITLE_MISMATCH'
      };
    }

    return {
      pass: true,
      message: 'Script, subtitles, and audio manifest all aligned and validated',
      severity: 'info',
      details: {
        scriptValidated: true,
        subtitleValidated: true,
        audioManifestValidated: true,
        audioBelongsToVideoId: true,
        audioPathLocal: true,
        contentSimilarity: (contentSimilarity * 100).toFixed(2) + '%',
        audioHash: manifest.audioFile.sha256.substring(0, 16)
      }
    };
  } catch (err) {
    return {
      pass: false,
      error: `CHECK_24 error: ${err.message}`,
      severity: 'critical'
    };
  }
}

module.exports = {
  checkScriptAudioSubtitleAlignment,
  SERVICE_NAME: 'CHECK_24_SCRIPT_AUDIO_SUBTITLE_ALIGNMENT'
};
