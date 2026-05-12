#!/usr/bin/env node
/**
 * audit-all-videos-audio-manifest.js
 *
 * Audita todos los vídeos en output-fase1-test
 * Bloquea aquellos sin audio-manifest.json válido
 * Marca con needsRevalidation=true y publicable=false
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const fs = require('fs');
const path = require('path');
const { validateAudioManifest } = require('../src/services/audio-manifest.service');

// Resolve OUTPUT_DIR relative to backend directory for consistency
const OUTPUT_DIR = path.resolve(path.join(__dirname, '../output-fase1-test'));

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
};

function log(text, color = 'reset') {
  console.log(`${colors[color]}${text}${colors.reset}`);
}

function logSection(title) {
  console.log(`\n${colors.blue}${'═'.repeat(70)}${colors.reset}`);
  console.log(`${colors.blue}${title}${colors.reset}`);
  console.log(`${colors.blue}${'═'.repeat(70)}${colors.reset}\n`);
}

function main() {
  logSection('AUDITORÍA DE AUDIO-MANIFEST PARA TODOS LOS VIDEOS');

  if (!fs.existsSync(OUTPUT_DIR)) {
    log(`❌ Directorio no encontrado: ${OUTPUT_DIR}`, 'red');
    process.exit(1);
  }

  const videoIds = fs.readdirSync(OUTPUT_DIR).filter(name => {
    if (name.startsWith('.')) return false; // Exclude hidden/dot-prefixed
    const stat = fs.statSync(path.join(OUTPUT_DIR, name));
    return stat.isDirectory();
  });

  log(`Encontrados ${videoIds.length} vídeos para auditar\n`, 'blue');

  let passCount = 0;
  let failCount = 0;
  const results = {
    videoId: videoIds,
    auditedAt: new Date().toISOString(),
    summary: {
      total: videoIds.length,
      valid: 0,
      missing: 0,
      invalid: 0,
    },
    videos: []
  };

  videoIds.forEach((videoId) => {
    const videoDir = path.join(OUTPUT_DIR, videoId);
    const manifestPath = path.join(videoDir, 'audio-manifest.json');
    const publishedPath = path.join(videoDir, 'published.json');
    const qcPath = path.join(videoDir, 'qc.json');

    try {
      // 1. Check if audio-manifest exists
      if (!fs.existsSync(manifestPath)) {
        log(`❌ ${videoId.substring(0, 8)}... - MISSING audio-manifest.json`, 'red');
        failCount++;
        results.summary.missing++;

        // Mark as blocked
        const blocking = {
          videoId,
          status: 'BLOCKED',
          reason: 'MISSING_AUDIO_MANIFEST',
          needsRevalidation: true,
          publicable: false,
        };

        // Update qc.json if exists
        if (fs.existsSync(qcPath)) {
          try {
            const qc = JSON.parse(fs.readFileSync(qcPath, 'utf8'));
            qc.needsRevalidation = true;
            qc.publicable = false;
            qc.blockReason = 'MISSING_AUDIO_MANIFEST';
            qc.auditedAt = new Date().toISOString();
            fs.writeFileSync(qcPath, JSON.stringify(qc, null, 2));
          } catch (e) {
            // ignore
          }
        }

        results.videos.push(blocking);
        return;
      }

      // 2. Validate audio-manifest
      const manifestValidation = validateAudioManifest(videoId, manifestPath);

      if (!manifestValidation.valid) {
        log(`❌ ${videoId.substring(0, 8)}... - INVALID audio-manifest.json: ${manifestValidation.error}`, 'red');
        failCount++;
        results.summary.invalid++;

        const blocking = {
          videoId,
          status: 'BLOCKED',
          reason: 'INVALID_AUDIO_MANIFEST',
          error: manifestValidation.error,
          needsRevalidation: true,
          publicable: false,
        };

        // Update qc.json
        if (fs.existsSync(qcPath)) {
          try {
            const qc = JSON.parse(fs.readFileSync(qcPath, 'utf8'));
            qc.needsRevalidation = true;
            qc.publicable = false;
            qc.blockReason = 'INVALID_AUDIO_MANIFEST';
            qc.auditedAt = new Date().toISOString();
            fs.writeFileSync(qcPath, JSON.stringify(qc, null, 2));
          } catch (e) {
            // ignore
          }
        }

        results.videos.push(blocking);
        return;
      }

      // 3. Valid
      log(`✓ ${videoId.substring(0, 8)}... - Valid audio-manifest`, 'green');
      passCount++;
      results.summary.valid++;

      results.videos.push({
        videoId,
        status: 'VALID',
        audioHash: manifestValidation.manifest.audioFile.sha256.substring(0, 16),
      });

    } catch (err) {
      log(`⚠️  ${videoId.substring(0, 8)}... - Error: ${err.message}`, 'yellow');
      failCount++;
      results.summary.invalid++;

      const blocking = {
        videoId,
        status: 'ERROR',
        error: err.message,
        needsRevalidation: true,
        publicable: false,
      };

      results.videos.push(blocking);
    }
  });

  // Summary
  logSection('RESUMEN');
  log(`Total vídeos:              ${results.summary.total}`, 'blue');
  log(`Con audio-manifest válido: ${results.summary.valid} ${colors.green}✓${colors.reset}`, 'blue');
  log(`Sin audio-manifest:        ${results.summary.missing} ${colors.red}✗${colors.reset}`, 'blue');
  log(`Con audio-manifest inválido: ${results.summary.invalid} ${colors.red}✗${colors.reset}`, 'blue');

  // Save audit report
  const auditPath = path.join(OUTPUT_DIR, '..', 'data', 'audio-manifest-audit.json');
  const dataDir = path.dirname(auditPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  fs.writeFileSync(auditPath, JSON.stringify(results, null, 2));
  log(`\n✓ Audit report saved: audio-manifest-audit.json`, 'green');

  if (failCount > 0) {
    log(`\n⚠️  ${failCount} vídeos necesitan revalidación y están bloqueados\n`, 'yellow');
  }

  process.exit(failCount > 0 ? 1 : 0);
}

main();
