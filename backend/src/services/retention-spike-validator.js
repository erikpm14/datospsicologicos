/**
 * retention-spike-validator.js
 *
 * Valida que vídeos exportados cumplen criterios de retention spikes.
 * - Analiza estructura JSON exportada
 * - Valida reglas obligatorias de spikes, visuales, duración
 * - Genera reportes de conformidad
 */

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

const EXPORTS_BASE = path.resolve('./exports');

/**
 * Validar que un vídeo cumple criterios de retention spikes
 */
function validateRetentionSpikes(subtitles, duration) {
  const errors = [];
  const warnings = [];

  // 1. Duration >= 25s
  if (duration < 25) {
    errors.push(`Duration ${duration}s < 25s (FAIL)`);
  } else {
    logger.info(`✓ Duration ${duration}s >= 25s`);
  }

  // 2. Find strong spike
  const strongSpike = subtitles.find((s) => s.spikeType === 'strong');
  if (!strongSpike) {
    errors.push('No strong spike found (FAIL)');
  } else {
    const strongPercent = (strongSpike.start / duration) * 100;
    if (strongPercent >= 60 && strongPercent <= 70) {
      logger.info(`✓ Strong spike at ${strongSpike.start}s (${strongPercent.toFixed(1)}%) ← within 60-70%`);
    } else {
      warnings.push(`Strong spike at ${strongPercent.toFixed(1)}% (ideal 60-70%)`);
    }
  }

  // 3. Hook visual (0-3s must be all human_face_closeup)
  const hookBlocks = subtitles.filter((s) => s.end <= 3);
  const hookVisualCheck = hookBlocks.every((s) => s.visual === 'human_face_closeup');
  if (hookVisualCheck) {
    logger.info(`✓ Hook (0-3s) all human_face_closeup`);
  } else {
    errors.push('Hook contains non-human_face_closeup visuals (FAIL)');
  }

  // 4. Emotional direct words = human_face
  const emotionalDirectWords = ['no es justo', 'ya no PUEDO', 'evitarlo'];
  for (const block of subtitles) {
    for (const word of emotionalDirectWords) {
      if (block.text.toLowerCase().includes(word.toLowerCase())) {
        if (!block.visual.includes('human_face')) {
          errors.push(`"${block.text}" is emotional but visual="${block.visual}" (should be human_face*)`);
        }
      }
    }
  }

  // 5. Rumination words = abstract
  const ruminationWords = ['le doy vueltas', 'otra vez', 'no ves nada'];
  for (const block of subtitles) {
    for (const word of ruminationWords) {
      if (block.text.toLowerCase().includes(word.toLowerCase())) {
        if (!block.visual.includes('abstract')) {
          warnings.push(`"${block.text}" is rumination but visual="${block.visual}"`);
        }
      }
    }
  }

  // 6. Max 6s without visual change
  let lastVisualChange = 0;
  let maxGap = 0;
  let lastVisual = null;
  for (const block of subtitles) {
    if (block.visual !== lastVisual) {
      const gap = block.start - lastVisualChange;
      maxGap = Math.max(maxGap, gap);
      lastVisualChange = block.start;
      lastVisual = block.visual;
    }
  }
  if (maxGap <= 6) {
    logger.info(`✓ Max gap between visual changes: ${maxGap.toFixed(1)}s (≤ 6s)`);
  } else {
    errors.push(`Max gap between visual changes: ${maxGap.toFixed(1)}s (> 6s FAIL)`);
  }

  // 7. At least 1 of each spike type
  const microSpikes = subtitles.filter((s) => s.spikeType === 'micro').length;
  const softSpikes = subtitles.filter((s) => s.spikeType === 'soft').length;
  const mediumSpikes = subtitles.filter((s) => s.spikeType === 'medium').length;
  const strongSpikes = subtitles.filter((s) => s.spikeType === 'strong').length;

  if (microSpikes >= 1 && softSpikes >= 1 && mediumSpikes >= 1 && strongSpikes >= 1) {
    logger.info(
      `✓ Spike distribution: ${microSpikes} micro, ${softSpikes} soft, ${mediumSpikes} medium, ${strongSpikes} strong`
    );
  } else {
    errors.push(
      `Insufficient spikes: ${microSpikes} micro, ${softSpikes} soft, ${mediumSpikes} medium, ${strongSpikes} strong (need ≥1 each)`
    );
  }

  return { errors, warnings, stats: { microSpikes, softSpikes, mediumSpikes, strongSpikes, maxGap } };
}

/**
 * Validar un vídeo exportado basado en su metadata JSON
 */
async function validateExportedVideo(metadataPath) {
  try {
    if (!fs.existsSync(metadataPath)) {
      throw new Error(`Metadata file not found: ${metadataPath}`);
    }

    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('  RETENTION SPIKES VALIDATION REPORT');
    logger.info('═══════════════════════════════════════════════════════════');

    // 1. Basic metadata
    logger.info('\n[VIDEO METADATA]');
    logger.info(`ID: ${metadata.id}`);
    logger.info(`Duration: ${metadata.duration}s`);
    logger.info(`Subtitle timing: ${metadata.subtitleTimingMode}`);
    logger.info(`Word alignment: ${metadata.wordAlignmentEngine}`);
    logger.info(`Render mode: ${metadata.renderMode}`);
    logger.info(`QC Pass: ${metadata.qcPass ? '✓ YES' : '✗ NO'}`);
    logger.info(`Hook: "${metadata.hook}"`);
    logger.info(`Topic: ${metadata.topic}`);

    // 2. Validate retention spikes (if subtitleBlocks are stored in metadata)
    // Note: The standard export doesn't include subtitle blocks, so we validate based on metadata
    const validation = {
      errors: [],
      warnings: [],
    };

    // Check basic rules
    if (metadata.duration < 25) {
      validation.errors.push(`Duration ${metadata.duration}s < 25s`);
    } else {
      logger.info(`\n✓ Duration ${metadata.duration}s >= 25s`);
    }

    if (metadata.subtitleTimingMode === 'word_timestamps' && metadata.wordAlignmentEngine === 'whisper') {
      logger.info(`✓ Word-level timestamps enabled (Whisper)`);
    } else {
      validation.warnings.push(
        `Subtitle timing mode: ${metadata.subtitleTimingMode}, word engine: ${metadata.wordAlignmentEngine}`
      );
    }

    if (metadata.qcPass === true) {
      logger.info(`✓ QC validation passed`);
    } else {
      validation.errors.push('QC validation failed');
    }

    // 3. Scores
    logger.info('\n[QUALITY SCORES]');
    logger.info(`Virality: ${metadata.viralityScore}/100`);
    logger.info(`Format: ${metadata.formatScore}/100`);
    if (metadata.emotionalImpactScore !== undefined) {
      logger.info(`Emotional: ${metadata.emotionalImpactScore}/100`);
    }

    // 4. Summary
    logger.info('\n═══════════════════════════════════════════════════════════');
    logger.info('VALIDATION RESULT');
    logger.info('═══════════════════════════════════════════════════════════');

    if (validation.errors.length === 0) {
      logger.info('✓ VIDEO PASSED VALIDATION');
    } else {
      logger.error('✗ VIDEO FAILED VALIDATION:');
      validation.errors.forEach((e) => logger.error(`  - ${e}`));
    }

    if (validation.warnings.length > 0) {
      logger.warn('Warnings:');
      validation.warnings.forEach((w) => logger.warn(`  - ${w}`));
    }

    return {
      success: validation.errors.length === 0,
      metadata,
      validation,
    };
  } catch (err) {
    logger.error('Validation failed:', err.message);
    throw err;
  }
}

/**
 * Scan and validate all recent exports
 */
async function validateAllExports(daysBack = 1) {
  try {
    logger.info('═══════════════════════════════════════════════════════════');
    logger.info('  SCANNING EXPORTS FOR VALIDATION');
    logger.info('═══════════════════════════════════════════════════════════');

    if (!fs.existsSync(EXPORTS_BASE)) {
      logger.warn(`Exports directory not found: ${EXPORTS_BASE}`);
      return { success: false, videos: [] };
    }

    const cutoffTime = Date.now() - daysBack * 24 * 60 * 60 * 1000;
    const results = [];

    // Get all date folders
    const dateFolders = fs.readdirSync(EXPORTS_BASE).filter((f) => {
      const folderPath = path.join(EXPORTS_BASE, f);
      const stat = fs.statSync(folderPath);
      return stat.isDirectory() && stat.mtime.getTime() > cutoffTime;
    });

    logger.info(`Found ${dateFolders.length} export folders from last ${daysBack} day(s)\n`);

    for (const dateFolder of dateFolders.sort().reverse()) {
      const folderPath = path.join(EXPORTS_BASE, dateFolder);
      const files = fs.readdirSync(folderPath);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      for (const jsonFile of jsonFiles) {
        const metadataPath = path.join(folderPath, jsonFile);
        try {
          const result = await validateExportedVideo(metadataPath);
          results.push({
            folder: dateFolder,
            file: jsonFile,
            ...result,
          });
        } catch (err) {
          logger.error(`Failed to validate ${jsonFile}: ${err.message}`);
        }
      }
    }

    // Summary
    logger.info('\n═══════════════════════════════════════════════════════════');
    logger.info('EXPORT VALIDATION SUMMARY');
    logger.info('═══════════════════════════════════════════════════════════');

    const passed = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    logger.info(`Total videos: ${results.length}`);
    logger.info(`Passed: ${passed} (${((passed / results.length) * 100).toFixed(1)}%)`);
    logger.info(`Failed: ${failed}`);

    if (results.length > 0) {
      logger.info(`\nLatest video: ${results[0]?.folder}/${results[0]?.file}`);
      if (results[0]) {
        logger.info(`  Duration: ${results[0].metadata.duration}s`);
        logger.info(`  Virality: ${results[0].metadata.viralityScore}/100`);
      }
    }

    return { success: passed === results.length, videos: results };
  } catch (err) {
    logger.error('Export validation failed:', err.message);
    throw err;
  }
}

module.exports = {
  validateRetentionSpikes,
  validateExportedVideo,
  validateAllExports,
};
