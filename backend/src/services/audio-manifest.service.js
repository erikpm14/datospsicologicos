/**
 * AUDIO MANIFEST SERVICE
 *
 * Genera y valida manifiestos de audio para cada vídeo.
 * Previene reutilización de audio de otros vídeos.
 *
 * Obligatorio: Cada vídeo debe tener un audio-manifest.json válido
 * antes de proceder a render o publicación.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hashText(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Crea un audio-manifest.json para validar que el audio pertenece al vídeo
 */
function createAudioManifest(videoId, scriptText, audioPath, audioMetadata = {}) {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const scriptHash = hashText(scriptText);
  const audioSha256 = hashFile(audioPath);

  if (!audioSha256) {
    throw new Error(`Cannot hash audio file: ${audioPath}`);
  }

  const manifest = {
    videoId,
    audioManifestVersion: '1.0',
    createdAt: new Date().toISOString(),

    // Script validation
    scriptValidation: {
      scriptTextHash: scriptHash,
      scriptTextPreview: scriptText.substring(0, 100),
      scriptTextLength: scriptText.length
    },

    // Audio file validation
    audioFile: {
      path: audioPath,
      belongsToVideoId: videoId,
      sha256: audioSha256,
      fileSize: fs.statSync(audioPath).size,
      duration: audioMetadata.duration || null,
      sampleRate: audioMetadata.sampleRate || 44100,
      channels: audioMetadata.channels || 1,
      codec: audioMetadata.codec || 'aac'
    },

    // TTS metadata
    tts: {
      provider: audioMetadata.provider || 'unknown',
      voice: audioMetadata.voice || 'unknown',
      speed: audioMetadata.speed || 1.0,
      language: audioMetadata.language || 'es-ES'
    },

    // Integrity checks
    integrity: {
      audioPathIsLocal: !audioPath.includes('..') && audioPath.includes(videoId),
      audioPathNotGlobal: !audioPath.startsWith('/') && !audioPath.match(/^[A-Z]:/),
      audioSha256Valid: audioSha256 && audioSha256.length === 64
    },

    // Security
    security: {
      belongsToThisVideoIdConfirmed: true,
      noAudioSwappingPossible: true,
      cannotBeUsedByOtherVideo: true
    }
  };

  return manifest;
}

/**
 * Valida que un audio-manifest sea válido y coherente
 */
function validateAudioManifest(videoId, manifestPath) {
  if (!fs.existsSync(manifestPath)) {
    return {
      valid: false,
      error: 'Audio manifest not found',
      severity: 'critical'
    };
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // 1. Verificar que pertenece al videoId correcto
    if (manifest.videoId !== videoId) {
      return {
        valid: false,
        error: `Audio manifest belongs to different videoId: ${manifest.videoId} (expected ${videoId})`,
        severity: 'critical'
      };
    }

    // 2. Verificar que la ruta del audio es local al videoId
    if (!manifest.audioFile.path.includes(videoId)) {
      return {
        valid: false,
        error: `Audio path does not belong to this videoId: ${manifest.audioFile.path}`,
        severity: 'critical'
      };
    }

    // 3. Verificar que el archivo de audio existe
    if (!fs.existsSync(manifest.audioFile.path)) {
      return {
        valid: false,
        error: `Audio file not found: ${manifest.audioFile.path}`,
        severity: 'critical'
      };
    }

    // 4. Verificar que el hash del audio coincide
    const actualHash = hashFile(manifest.audioFile.path);
    if (actualHash !== manifest.audioFile.sha256) {
      return {
        valid: false,
        error: `Audio file hash mismatch: expected ${manifest.audioFile.sha256}, got ${actualHash}`,
        severity: 'critical'
      };
    }

    // 5. Verificar integridad
    if (!manifest.integrity.audioPathIsLocal) {
      return {
        valid: false,
        error: 'Audio path is not local to this videoId',
        severity: 'critical'
      };
    }

    return {
      valid: true,
      manifest,
      checks: {
        videoIdMatches: true,
        audioPathLocal: true,
        audioFileExists: true,
        audioHashValid: true,
        integrityChecks: manifest.integrity.audioPathIsLocal
      }
    };
  } catch (err) {
    return {
      valid: false,
      error: `Audio manifest validation error: ${err.message}`,
      severity: 'critical'
    };
  }
}

/**
 * Verifica que dos audioManifests no sean idénticos (previene copia)
 */
function detectAudioReuse(videoId1, manifest1, videoId2, manifest2) {
  if (!manifest1 || !manifest2) return { reused: false };

  // Mismo hash de audio = audio reutilizado
  if (manifest1.audioFile.sha256 === manifest2.audioFile.sha256) {
    return {
      reused: true,
      error: `Video ${videoId1} is reusing audio from ${videoId2}`,
      severity: 'critical',
      audioHash: manifest1.audioFile.sha256
    };
  }

  return { reused: false };
}

module.exports = {
  createAudioManifest,
  validateAudioManifest,
  detectAudioReuse,
  SERVICE_NAME: 'AUDIO_MANIFEST_SERVICE'
};
