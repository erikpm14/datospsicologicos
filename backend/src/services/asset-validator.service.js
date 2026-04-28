/**
 * Asset Validator & Fixer Service
 *
 * ANTES de pasar clips a FFmpeg:
 * 1. Valida que TODOS los assets existen en disco
 * 2. Si falta un asset, intenta redownloadear
 * 3. Si no se puede descargar, reemplaza con asset válido local
 * 4. Si no hay assets válidos, BLOQUEA render (no permite color=black fallback)
 *
 * Uso:
 *   const validClips = await validateAndFixAssets(clipPaths, script, outputDir);
 *   if (!validClips) throw new Error('RENDER_BLOCKED_MISSING_VISUAL_ASSET');
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const logger = require('../utils/logger');

const CACHE_DIR = path.resolve('./assets/stock-footage');
const SEARCH_CACHE_PATH = path.join(CACHE_DIR, '_search_cache.json');

function readSearchCache() {
  try {
    if (fs.existsSync(SEARCH_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(SEARCH_CACHE_PATH, 'utf8'));
    }
  } catch (err) {
    logger.warn(`Failed to read search cache: ${err.message}`);
  }
  return {};
}

function writeSearchCache(cache) {
  try {
    fs.writeFileSync(SEARCH_CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
  } catch (err) {
    logger.warn(`Failed to write search cache: ${err.message}`);
  }
}

async function _redownloadAsset(assetId, script) {
  /**
   * Intenta redownloadear un asset de Pexels si está en el cache de búsqueda.
   * Retorna: path si éxito, null si falla
   */
  try {
    const searchCache = readSearchCache();
    const cacheEntry = Object.values(searchCache).find((e) => e.id === assetId);

    if (!cacheEntry || !cacheEntry.link) {
      logger.warn(`ASSET_REDOWNLOAD_FAILED assetId=${assetId} reason=not_in_cache`);
      return null;
    }

    const cachedPath = path.join(CACHE_DIR, `pexels_${assetId}.mp4`);
    logger.info(`ASSET_REDOWNLOAD_ATTEMPT assetId=${assetId}`);

    const writer = fs.createWriteStream(cachedPath);
    const download = await axios.get(cacheEntry.link, {
      responseType: 'stream',
      timeout: 90000,
    });

    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
      download.data.on('error', reject);
    });

    if (!fs.existsSync(cachedPath) || fs.statSync(cachedPath).size < 1000000) {
      throw new Error('Downloaded file too small');
    }

    logger.info(`ASSET_REDOWNLOAD_SUCCESS assetId=${assetId}`);
    return cachedPath;
  } catch (err) {
    logger.error(`ASSET_REDOWNLOAD_FAILED assetId=${assetId} error=${err.message}`);
    return null;
  }
}

function _getLocalAssetById(assetId) {
  /**
   * Busca asset localmente por ID
   */
  const filePath = path.join(CACHE_DIR, `pexels_${assetId}.mp4`);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
}

async function _findReplacementAsset(script) {
  /**
   * Busca el primer asset válido en disco.
   * Preferencia: clips descargados recientemente (últimas 48 horas)
   */
  try {
    const files = fs.readdirSync(CACHE_DIR)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => ({
        name: f,
        path: path.join(CACHE_DIR, f),
        mtime: fs.statSync(path.join(CACHE_DIR, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (files.length === 0) {
      logger.error('ASSET_REPLACEMENT_FAILED reason=no_local_assets');
      return null;
    }

    const candidate = files[0];
    logger.info(`ASSET_REPLACEMENT_FOUND file=${candidate.name} age_hours=${Math.round((Date.now() - candidate.mtime) / 3600000)}`);
    return candidate.path;
  } catch (err) {
    logger.error(`ASSET_REPLACEMENT_FAILED error=${err.message}`);
    return null;
  }
}

async function validateAndFixAssets(clipPaths, script, outputDir, videoId) {
  /**
   * Valida que todos los clips existan. Si falta alguno:
   * 1. Intenta redownloadear del cache de búsqueda
   * 2. Si no va, usa asset local válido
   * 3. Si no hay válido, retorna null (BLOQUEA render)
   *
   * Retorna: [validClip1, validClip2, ...] o null (bloquea)
   */

  logger.info(`ASSET_CHECK_START videoId=${videoId} clipCount=${clipPaths?.length || 0}`);

  if (!clipPaths || clipPaths.length === 0) {
    logger.warn(`ASSET_CHECK_EMPTY videoId=${videoId}`);
    return null;
  }

  const results = [];
  const missing = [];

  for (const clipPath of clipPaths) {
    if (!clipPath) {
      missing.push('null_reference');
      continue;
    }

    if (fs.existsSync(clipPath)) {
      // ✅ Existe — válido
      results.push(clipPath);
      logger.debug(`ASSET_CHECK_PASS file=${path.basename(clipPath)}`);
    } else {
      // ❌ Falta
      const fileName = path.basename(clipPath);
      const assetIdMatch = fileName.match(/pexels_(\d+)/);
      const assetId = assetIdMatch ? assetIdMatch[1] : null;

      logger.warn(`ASSET_MISSING file=${fileName} assetId=${assetId}`);
      missing.push(assetId || fileName);

      // Intenta redownloadear
      let recovered = null;
      if (assetId) {
        recovered = await _redownloadAsset(assetId, script);
      }

      if (recovered) {
        results.push(recovered);
        logger.info(`ASSET_RECOVERED assetId=${assetId} path=${recovered}`);
      } else {
        // Busca replacement local
        const replacement = await _findReplacementAsset(script);
        if (replacement) {
          results.push(replacement);
          logger.info(`ASSET_REPLACED missing=${assetId || fileName} replacement=${path.basename(replacement)}`);
        } else {
          // NO HAY REEMPLAZO — BLOQUEA RENDER
          logger.error(
            `ASSET_REPLACEMENT_FAILED assetId=${assetId} — No replacement available. ` +
            `Cannot render without visual assets. Render BLOCKED.`
          );
          return null;
        }
      }
    }
  }

  // Resumen
  if (missing.length > 0) {
    logger.warn(`ASSET_CHECK_RECOVERED_SUMMARY missing=${missing.length} recovered=${results.length} videoId=${videoId}`);
  } else {
    logger.info(`ASSET_CHECK_PASS_ALL videoId=${videoId} clipCount=${results.length}`);
  }

  return results;
}

module.exports = {
  validateAndFixAssets,
};
