/**
 * script-cache.js
 * Caché en memoria + disco para guiones aprobados.
 *
 * Evita llamadas duplicadas a Claude cuando el decision-engine
 * decide el mismo topic+angle+hookType en rápida sucesión
 * (reinicios del servidor, pruebas manuales, ciclos de generación solapados).
 *
 * TTL por defecto: 4 horas (configurable con SCRIPT_CACHE_TTL_HOURS).
 * No guarda scripts rechazados (solo aprobados con score >= umbrales).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const CACHE_PATH = path.resolve('./data/script-cache.json');
const TTL_MS     = (parseFloat(process.env.SCRIPT_CACHE_TTL_HOURS || '4')) * 60 * 60 * 1000;
const MAX_ENTRIES = 50; // máximo de entradas en caché para no crecer indefinidamente

// ── Cache en memoria (inicializado desde disco al arrancar) ──────────────────
let memCache = null;  // { key: { script, cachedAt, expiresAt } }

function loadCache() {
  if (memCache !== null) return;
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'));
      memCache  = raw || {};
    } else {
      memCache = {};
    }
  } catch {
    memCache = {};
  }
  // Purgar entradas expiradas al cargar
  purgeExpired();
}

function saveCache() {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(memCache, null, 2));
  } catch (err) {
    logger.warn(`Script Cache: save failed: ${err.message}`);
  }
}

function purgeExpired() {
  if (!memCache) return;
  const now = Date.now();
  let purged = 0;
  for (const [key, entry] of Object.entries(memCache)) {
    if (entry.expiresAt < now) {
      delete memCache[key];
      purged++;
    }
  }
  if (purged > 0) logger.debug(`Script Cache: purged ${purged} expired entries`);
}

// ─────────────────────────────────────────────
//  API
// ─────────────────────────────────────────────

/**
 * Construye la clave de caché.
 * Suficientemente específica para evitar colisiones, suficientemente general
 * para capturar decisiones verdaderamente duplicadas.
 */
function buildKey(topic, angle, hookType) {
  // Normalizar angle a las primeras 4 palabras para que pequeñas variaciones
  // (mayúsculas, espacios extra) no rompan la caché
  const angleKey = (angle || '').toLowerCase().trim().split(/\s+/).slice(0, 4).join('_');
  return `${topic}__${angleKey}__${hookType}`;
}

/**
 * Busca un script en caché.
 *
 * @param {string} topic
 * @param {string} angle
 * @param {string} hookType
 * @returns {Object|null} script si hay hit válido, null si no
 */
function getFromCache(topic, angle, hookType) {
  loadCache();
  const key   = buildKey(topic, angle, hookType);
  const entry = memCache[key];

  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    delete memCache[key];
    return null;
  }

  const ageMin = Math.round((Date.now() - entry.cachedAt) / 60000);
  logger.info(`Script Cache: HIT | ${key} | age=${ageMin}m`);
  return { ...entry.script, _fromCache: true, _cacheAge: ageMin };
}

/**
 * Guarda un script aprobado en caché.
 * Solo se guarda si el script está aprobado (approved === true).
 *
 * @param {string} topic
 * @param {string} angle
 * @param {string} hookType
 * @param {Object} script
 */
function saveToCache(topic, angle, hookType, script) {
  if (!script?.approved) return; // nunca cachear rechazados

  loadCache();
  purgeExpired();

  // Limitar tamaño: si ya tenemos MAX_ENTRIES, eliminar la más antigua
  const keys = Object.keys(memCache);
  if (keys.length >= MAX_ENTRIES) {
    const oldest = keys.sort((a, b) => memCache[a].cachedAt - memCache[b].cachedAt)[0];
    delete memCache[oldest];
  }

  const key = buildKey(topic, angle, hookType);
  memCache[key] = {
    script:    script,
    cachedAt:  Date.now(),
    expiresAt: Date.now() + TTL_MS,
  };

  saveCache();
  logger.debug(`Script Cache: SAVE | ${key} | TTL=${TTL_MS / 3600000}h`);
}

/**
 * Invalida todas las entradas de un topic (cuando llegan nuevas métricas
 * que cambian el patrón óptimo para ese topic).
 *
 * @param {string} topic
 */
function invalidateTopic(topic) {
  loadCache();
  let count = 0;
  for (const key of Object.keys(memCache)) {
    if (key.startsWith(`${topic}__`)) {
      delete memCache[key];
      count++;
    }
  }
  if (count > 0) {
    saveCache();
    logger.info(`Script Cache: invalidated ${count} entries for topic="${topic}"`);
  }
}

/**
 * Vacía completamente la caché (útil desde /api/cache/clear).
 */
function clearCache() {
  memCache = {};
  saveCache();
  logger.info('Script Cache: cleared');
}

/**
 * Estadísticas de la caché para observabilidad.
 */
function getCacheStats() {
  loadCache();
  purgeExpired();

  const now     = Date.now();
  const entries = Object.entries(memCache).map(([key, entry]) => ({
    key,
    ageMin:    Math.round((now - entry.cachedAt) / 60000),
    expiresIn: Math.round((entry.expiresAt - now) / 60000),
    topic:     entry.script?.topic,
    hookType:  entry.script?.growthContext?.hookType,
    score:     entry.script?.viralityScore,
  }));

  return {
    size:    entries.length,
    maxSize: MAX_ENTRIES,
    ttlHours: TTL_MS / 3600000,
    entries,
  };
}

module.exports = {
  getFromCache,
  saveToCache,
  invalidateTopic,
  clearCache,
  getCacheStats,
};
