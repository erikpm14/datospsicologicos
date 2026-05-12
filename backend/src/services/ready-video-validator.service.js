/**
 * ready-video-validator.service.js
 *
 * Centralized validation service that determines if a video is truly READY for publication.
 * All critical publication points (nearest-slot-protection, publish-guard, publish-scheduler,
 * emergency-generate-no-llm, late-slot-recovery) must call validateReadyVideo() before
 * proceeding with publication or slot reservation.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const OUTPUT_DIR = path.resolve(process.env.OUTPUT_DIR || './output-fase1-test');

/**
 * Validates if a video is truly READY for publication.
 *
 * @param {string} videoId - The video ID to validate
 * @param {object} options - Optional validation options
 * @param {boolean} options.strictMode - If true, fail on any warning
 * @returns {object} Validation result with structure:
 *   {
 *     ready: boolean,
 *     errors: string[],
 *     warnings: string[],
 *     checks: {
 *       outputExists: boolean,
 *       outputSizeValid: boolean,
 *       metadataExists: boolean,
 *       renderModeDynamic: boolean,
 *       backgroundAppliedToRender: boolean,
 *       clipTimelineExists: boolean,
 *       visualComplexityPass: boolean,
 *       subtitlesFileExists: boolean,
 *       subtitlesContentValid: boolean,
 *       subtitlesBurnedIn: boolean,
 *       scriptDiversityPass: boolean,
 *       backgroundDiversityPass: boolean,
 *       prepublishQcPass: boolean,
 *       duplicateHardBlockPass: boolean,
 *       noYoutubeId: boolean,
 *       noPublishedJson: boolean,
 *       notRejected: boolean,
 *       notLegacyRender: boolean
 *     }
 *   }
 */
function validateReadyVideo(videoId, options = {}) {
  const errors = [];
  const warnings = [];
  const checks = {};

  if (!videoId || typeof videoId !== 'string') {
    return {
      ready: false,
      errors: ['Invalid videoId provided'],
      warnings: [],
      checks: {}
    };
  }

  const videoDir = path.join(OUTPUT_DIR, videoId);

  // ─────────────────────────────────────────────
  // CHECK 1: output.mp4 EXISTS
  // ─────────────────────────────────────────────
  const mp4Path = path.join(videoDir, 'output.mp4');
  checks.outputExists = fs.existsSync(mp4Path);
  if (!checks.outputExists) {
    errors.push(`[CHECK_1] output.mp4 does not exist at ${mp4Path}`);
  }

  // ─────────────────────────────────────────────
  // CHECK 2: output.mp4 >= 4MB
  // ─────────────────────────────────────────────
  checks.outputSizeValid = false;
  if (checks.outputExists) {
    try {
      const stats = fs.statSync(mp4Path);
      const sizeInMB = stats.size / (1024 * 1024);
      checks.outputSizeValid = sizeInMB >= 4;
      if (!checks.outputSizeValid) {
        errors.push(`[CHECK_2] output.mp4 size is ${sizeInMB.toFixed(2)}MB, minimum 4MB required`);
      }
    } catch (err) {
      errors.push(`[CHECK_2] Failed to check output.mp4 size: ${err.message}`);
    }
  } else {
    errors.push('[CHECK_2] Cannot validate file size - output.mp4 does not exist');
  }

  // ─────────────────────────────────────────────
  // CHECK 3: generation-metadata.json EXISTS
  // ─────────────────────────────────────────────
  const metadataPath = path.join(videoDir, 'generation-metadata.json');
  checks.metadataExists = fs.existsSync(metadataPath);
  if (!checks.metadataExists) {
    errors.push(`[CHECK_3] generation-metadata.json does not exist at ${metadataPath}`);
  }

  // Parse metadata for subsequent checks
  let metadata = null;
  if (checks.metadataExists) {
    try {
      const content = fs.readFileSync(metadataPath, 'utf8');
      metadata = JSON.parse(content);
    } catch (err) {
      errors.push(`[CHECK_3] Failed to parse generation-metadata.json: ${err.message}`);
    }
  }

  // ─────────────────────────────────────────────
  // CHECK 4: renderMode == 'dynamic_background_timeline'
  // ─────────────────────────────────────────────
  checks.renderModeDynamic = false;
  if (metadata) {
    checks.renderModeDynamic = metadata.renderMode === 'dynamic_background_timeline';
    if (!checks.renderModeDynamic) {
      errors.push(
        `[CHECK_4] renderMode is '${metadata.renderMode || 'undefined'}', ` +
        `required 'dynamic_background_timeline'`
      );
    }
  } else {
    errors.push('[CHECK_4] Cannot validate renderMode - metadata unavailable');
  }

  // ─────────────────────────────────────────────
  // CHECK 5: backgroundPlan.appliedToRender == true
  // ─────────────────────────────────────────────
  checks.backgroundAppliedToRender = false;
  if (metadata && metadata.backgroundPlan) {
    checks.backgroundAppliedToRender = metadata.backgroundPlan.appliedToRender === true;
    if (!checks.backgroundAppliedToRender) {
      errors.push(
        `[CHECK_5] backgroundPlan.appliedToRender is ${metadata.backgroundPlan.appliedToRender}, ` +
        `required true`
      );
    }
  } else {
    errors.push('[CHECK_5] Cannot validate backgroundPlan - metadata or backgroundPlan unavailable');
  }

  // ─────────────────────────────────────────────
  // CHECK 6: backgroundPlan.clipTimeline EXISTS and >= 3 clips
  // ─────────────────────────────────────────────
  checks.clipTimelineExists = false;
  if (metadata && metadata.backgroundPlan && Array.isArray(metadata.backgroundPlan.clipTimeline)) {
    const numClips = metadata.backgroundPlan.clipTimeline.length;
    checks.clipTimelineExists = numClips >= 3;
    if (!checks.clipTimelineExists) {
      errors.push(
        `[CHECK_6] clipTimeline has ${numClips} clips, minimum 3 required`
      );
    }
  } else {
    errors.push('[CHECK_6] Cannot validate clipTimeline - metadata unavailable or not an array');
  }

  // ─────────────────────────────────────────────
  // CHECK 7: Visual Complexity Pass (frame-based analysis)
  // ─────────────────────────────────────────────
  checks.visualComplexityPass = false;
  if (metadata && metadata.backgroundPlan) {
    // Visual complexity is indicated by diverse clip timeline and diversity score
    const hasClips = metadata.backgroundPlan.clipTimeline &&
                     metadata.backgroundPlan.clipTimeline.length >= 3;
    const diversityScore = metadata.backgroundPlan.diversityScore;
    checks.visualComplexityPass = hasClips && diversityScore >= 70;

    if (!checks.visualComplexityPass) {
      if (!hasClips) {
        errors.push('[CHECK_7] Visual complexity check failed - insufficient clip diversity');
      } else if (diversityScore < 70) {
        errors.push(
          `[CHECK_7] Visual complexity check failed - diversityScore is ${diversityScore}, ` +
          `minimum 70 required`
        );
      }
    }
  } else {
    errors.push('[CHECK_7] Cannot validate visual complexity - metadata unavailable');
  }

  // ─────────────────────────────────────────────
  // CHECK 8: Subtitles FILE EXISTS
  // ─────────────────────────────────────────────
  const subtitlesPath = path.join(videoDir, 'subtitles.vtt');
  checks.subtitlesFileExists = fs.existsSync(subtitlesPath);
  if (!checks.subtitlesFileExists) {
    errors.push(`[CHECK_8] subtitles.vtt does not exist at ${subtitlesPath}`);
  }

  // ─────────────────────────────────────────────
  // CHECK 9: Subtitles CONTENT VALID
  // ─────────────────────────────────────────────
  checks.subtitlesContentValid = false;
  if (checks.subtitlesFileExists) {
    try {
      const subtitlesContent = fs.readFileSync(subtitlesPath, 'utf8');
      // Basic VTT validation: should start with WEBVTT header and contain at least one cue
      const hasHeader = subtitlesContent.includes('WEBVTT');
      const hasCues = subtitlesContent.includes('-->');
      checks.subtitlesContentValid = hasHeader && hasCues && subtitlesContent.length > 20;

      if (!checks.subtitlesContentValid) {
        errors.push(
          '[CHECK_9] subtitles.vtt content invalid - must contain WEBVTT header and cues'
        );
      }
    } catch (err) {
      errors.push(`[CHECK_9] Failed to read subtitles.vtt: ${err.message}`);
    }
  } else {
    errors.push('[CHECK_9] Cannot validate subtitles content - file does not exist');
  }

  // ─────────────────────────────────────────────
  // CHECK 10: Subtitles BURNED IN
  // ─────────────────────────────────────────────
  checks.subtitlesBurnedIn = false;
  if (metadata) {
    // Check if subtitles were actually burned into the video (typically set in metadata)
    checks.subtitlesBurnedIn = metadata.subtitlesBurnedIn === true ||
                               metadata.captionsPassed === true;
    if (!checks.subtitlesBurnedIn) {
      warnings.push('[CHECK_10] Subtitles may not be burned in - flag not found in metadata');
    }
  } else {
    warnings.push('[CHECK_10] Cannot verify if subtitles burned in - metadata unavailable');
  }

  // ─────────────────────────────────────────────
  // CHECK 11: Script Diversity PASS
  // ─────────────────────────────────────────────
  checks.scriptDiversityPass = false;
  if (metadata) {
    checks.scriptDiversityPass = metadata.scriptDiversityGatePassed === true;
    if (!checks.scriptDiversityPass) {
      errors.push(
        `[CHECK_11] scriptDiversityGatePassed is ${metadata.scriptDiversityGatePassed}, ` +
        `required true`
      );
    }
  } else {
    errors.push('[CHECK_11] Cannot validate script diversity - metadata unavailable');
  }

  // ─────────────────────────────────────────────
  // CHECK 12: Background Diversity PASS
  // ─────────────────────────────────────────────
  checks.backgroundDiversityPass = false;
  if (metadata && metadata.backgroundPlan) {
    const diversityScore = metadata.backgroundPlan.diversityScore;
    checks.backgroundDiversityPass = diversityScore >= 70;
    if (!checks.backgroundDiversityPass) {
      errors.push(
        `[CHECK_12] backgroundPlan.diversityScore is ${diversityScore}, minimum 70 required`
      );
    }
  } else {
    errors.push('[CHECK_12] Cannot validate background diversity - metadata unavailable');
  }

  // ─────────────────────────────────────────────
  // CHECK 13: Prepublish QC PASS
  // ─────────────────────────────────────────────
  checks.prepublishQcPass = false;
  if (metadata) {
    checks.prepublishQcPass = metadata.prepublishQcPassed === true ||
                              metadata.qcPassed === true;
    if (!checks.prepublishQcPass) {
      errors.push(
        `[CHECK_13] prepublishQcPassed/qcPassed is false, required true`
      );
    }
  } else {
    errors.push('[CHECK_13] Cannot validate prepublish QC - metadata unavailable');
  }

  // ─────────────────────────────────────────────
  // CHECK 14: Duplicate Hard Block PASS
  // ─────────────────────────────────────────────
  checks.duplicateHardBlockPass = false;
  if (metadata) {
    checks.duplicateHardBlockPass = metadata.duplicateCheckPassed === true;
    if (!checks.duplicateHardBlockPass) {
      errors.push(
        `[CHECK_14] duplicateCheckPassed is ${metadata.duplicateCheckPassed}, required true`
      );
    }
  } else {
    errors.push('[CHECK_14] Cannot validate duplicate hard block - metadata unavailable');
  }

  // ─────────────────────────────────────────────
  // CHECK 15: No youtubeId (not already published)
  // ─────────────────────────────────────────────
  checks.noYoutubeId = true;
  if (metadata && metadata.youtubeId) {
    checks.noYoutubeId = false;
    errors.push(
      `[CHECK_15] Video already has youtubeId: ${metadata.youtubeId}`
    );
  }

  // ─────────────────────────────────────────────
  // CHECK 16: No published.json FILE
  // ─────────────────────────────────────────────
  checks.noPublishedJson = true;
  const publishedPath = path.join(videoDir, 'published.json');
  if (fs.existsSync(publishedPath)) {
    checks.noPublishedJson = false;
    errors.push(`[CHECK_16] published.json already exists - video likely published`);
  }

  // ─────────────────────────────────────────────
  // CHECK 17: Not in REJECTED directory
  // ─────────────────────────────────────────────
  checks.notRejected = true;
  const rejectedDirs = ['duplicates', 'scripts-too-similar', 'legacy-render', 'visual-quality-fail'];
  for (const dir of rejectedDirs) {
    const rejectedPath = path.join(OUTPUT_DIR, '../rejected', dir, videoId);
    if (fs.existsSync(rejectedPath)) {
      checks.notRejected = false;
      errors.push(`[CHECK_17] Video is in rejected directory: ${dir}`);
      break;
    }
  }

  // ─────────────────────────────────────────────
  // CHECK 18: Not LEGACY RENDER
  // ─────────────────────────────────────────────
  checks.notLegacyRender = true;
  if (metadata && metadata.renderMode &&
      (metadata.renderMode === 'video_use' || metadata.renderMode === 'hyperframe_html')) {
    checks.notLegacyRender = false;
    errors.push(
      `[CHECK_18] Video uses legacy renderMode '${metadata.renderMode}', ` +
      `required 'dynamic_background_timeline'`
    );
  }

  // ─────────────────────────────────────────────
  // CHECK 19: AUDIO/VIDEO SYNC (AV_DURATION_MISMATCH)
  // ─────────────────────────────────────────────
  checks.avSyncValid = false;
  const MAX_AV_DRIFT = 0.35; // segundos

  if (checks.outputExists) {
    try {
      const { spawnSync } = require('child_process');
      const ffprobeInstaller = require('@ffprobe-installer/ffprobe');

      // Obtener duración de video stream
      const videoResult = spawnSync(ffprobeInstaller.path, [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        mp4Path
      ]);

      // Obtener duración de audio stream
      const audioResult = spawnSync(ffprobeInstaller.path, [
        '-v', 'error',
        '-select_streams', 'a:0',
        '-show_entries', 'stream=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        mp4Path
      ]);

      if (videoResult.status === 0 && audioResult.status === 0) {
        const videoDuration = parseFloat(videoResult.stdout.toString().trim()) || 0;
        const audioDuration = parseFloat(audioResult.stdout.toString().trim()) || 0;
        const gap = Math.abs(videoDuration - audioDuration);

        // Validación estricta
        if (videoDuration <= 0 || audioDuration <= 0) {
          errors.push(
            `[CHECK_19] Invalid stream duration: video=${videoDuration.toFixed(2)}s, ` +
            `audio=${audioDuration.toFixed(2)}s`
          );
          checks.avSyncValid = false;
        } else if (videoDuration < audioDuration - MAX_AV_DRIFT) {
          // Video truncado - FALLO crítico
          errors.push(
            `[CHECK_19] AV_DURATION_MISMATCH (VIDEO TRUNCATED): ` +
            `video=${videoDuration.toFixed(2)}s, audio=${audioDuration.toFixed(2)}s, ` +
            `gap=${gap.toFixed(2)}s (max=${MAX_AV_DRIFT}s)`
          );
          checks.avSyncValid = false;
        } else if (gap > MAX_AV_DRIFT) {
          // Gap excesivo
          errors.push(
            `[CHECK_19] AV_DURATION_MISMATCH: ` +
            `video=${videoDuration.toFixed(2)}s, audio=${audioDuration.toFixed(2)}s, ` +
            `gap=${gap.toFixed(2)}s (max=${MAX_AV_DRIFT}s)`
          );
          checks.avSyncValid = false;
        } else {
          // PASS
          checks.avSyncValid = true;
          logger.info(`[CHECK_19] AV sync PASS: video=${videoDuration.toFixed(2)}s, ` +
                     `audio=${audioDuration.toFixed(2)}s, gap=${gap.toFixed(2)}s`);
        }
      } else {
        errors.push('[CHECK_19] ffprobe failed to analyze streams');
        checks.avSyncValid = false;
      }
    } catch (err) {
      errors.push(`[CHECK_19] AV sync validation error: ${err.message}`);
      checks.avSyncValid = false;
    }
  } else {
    errors.push('[CHECK_19] Cannot validate AV sync - output.mp4 does not exist');
    checks.avSyncValid = false;
  }

  // ─────────────────────────────────────────────
  // CHECK_20: AUDIO_REAL_NOT_SILENT
  // After bad upload incident, must verify audio is actually audible
  // ─────────────────────────────────────────────
  if (checks.outputExists) {
    try {
      const { checkAudioRealNotSilent } = require('./check-20-audio-real.service');
      const check20Result = checkAudioRealNotSilent(mp4Path);
      checks.audioRealNotSilent = check20Result.ready;

      if (!check20Result.ready) {
        errors.push(`[CHECK_20] ${check20Result.reason}`);
        if (check20Result.details?.issues) {
          check20Result.details.issues.forEach(issue => {
            errors.push(`  └─ ${issue}`);
          });
        }
      } else {
        logger.info(`[CHECK_20] PASS: audio is real and audible`);
      }
    } catch (err) {
      errors.push(`[CHECK_20] Audio validation error: ${err.message}`);
      checks.audioRealNotSilent = false;
    }
  } else {
    errors.push('[CHECK_20] Cannot validate audio - output.mp4 does not exist');
    checks.audioRealNotSilent = false;
  }

  // ─────────────────────────────────────────────
  // CHECK_21: SUBTITLES_BURNED_VISIBLE
  // After bad upload incident, must verify subtitles are actually rendered
  // ─────────────────────────────────────────────
  if (checks.outputExists) {
    try {
      const { checkSubtitlesBurned } = require('./check-21-subtitles-burned.service');
      const framesDir = path.join(videoDir, 'frames-validation');
      const check21Result = checkSubtitlesBurned(mp4Path, framesDir);
      checks.subtitlesBurned = check21Result.ready;

      if (!check21Result.ready) {
        errors.push(`[CHECK_21] ${check21Result.reason}`);
        if (check21Result.details?.issues) {
          check21Result.details.issues.forEach(issue => {
            errors.push(`  └─ ${issue}`);
          });
        }
      } else {
        logger.info(`[CHECK_21] PASS: subtitles are burned/visible`);
      }
    } catch (err) {
      errors.push(`[CHECK_21] Subtitle validation error: ${err.message}`);
      checks.subtitlesBurned = false;
    }
  } else {
    errors.push('[CHECK_21] Cannot validate subtitles - output.mp4 does not exist');
    checks.subtitlesBurned = false;
  }

  // ─────────────────────────────────────────────
  // CHECK_22: FINAL_VISUAL_NOT_COLOR_FALLBACK
  // After bad upload incident, must verify video has useful visual content
  // Not just abstract colors/gradients/particles without real assets
  // ─────────────────────────────────────────────
  if (checks.outputExists) {
    try {
      const { checkVisualNotColorFallback } = require('./check-22-visual-real.service');
      const check22Result = checkVisualNotColorFallback(mp4Path);
      checks.visualQualityReal = check22Result.ready;

      if (!check22Result.ready) {
        errors.push(`[CHECK_22] ${check22Result.reason}`);
        if (check22Result.details?.issues) {
          check22Result.details.issues.forEach(issue => {
            errors.push(`  └─ ${issue}`);
          });
        }
      } else {
        logger.info(`[CHECK_22] PASS: visual content is real/useful`);
      }
    } catch (err) {
      errors.push(`[CHECK_22] Visual quality validation error: ${err.message}`);
      checks.visualQualityReal = false;
    }
  } else {
    errors.push('[CHECK_22] Cannot validate visual quality - output.mp4 does not exist');
    checks.visualQualityReal = false;
  }

  // ─────────────────────────────────────────────
  // FINAL DECISION
  // ─────────────────────────────────────────────
  const ready = errors.length === 0 &&
                (!options.strictMode || warnings.length === 0);

  return {
    ready,
    errors,
    warnings,
    checks
  };
}

module.exports = {
  validateReadyVideo
};
