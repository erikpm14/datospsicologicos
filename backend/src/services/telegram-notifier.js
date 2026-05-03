/**
 * telegram-notifier.js
 * Envía notificaciones al bot de Telegram cuando se publica un vídeo.
 * Requiere TELEGRAM_BOT_TOKEN y TELEGRAM_CHAT_ID en .env
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const DASHBOARD_URL = process.env.DASHBOARD_URL || `http://localhost:${process.env.PORT || 3001}`;
const ALERT_STATE_PATH = path.resolve('./data/telegram-alert-state.json');

const LEVELS = {
  DEBUG: 10,
  INFO: 20,
  WARNING: 30,
  ERROR: 40,
  CRITICAL: 50,
};

function getNotificationsEnabled() {
  return (process.env.TELEGRAM_NOTIFICATIONS_ENABLED || 'true') !== 'false';
}

function getMinLevel() {
  const raw = String(process.env.TELEGRAM_MIN_LEVEL || 'ERROR').toUpperCase();
  return LEVELS[raw] || LEVELS.ERROR;
}

function getCooldownMinutes() {
  return parseInt(process.env.TELEGRAM_COOLDOWN_MINUTES || '30', 10) || 30;
}

function getDigestEnabled() {
  return (process.env.TELEGRAM_DIGEST_ENABLED || 'true') !== 'false';
}

function getDigestHours() {
  return parseInt(process.env.TELEGRAM_DIGEST_HOURS || '6', 10) || 6;
}

function isConfigured() {
  return TOKEN && TOKEN !== 'RELLENAR' && CHAT_ID && CHAT_ID !== 'RELLENAR';
}

async function sendMessage(text) {
  if (!isConfigured() || !getNotificationsEnabled()) return false;
  try {
    if ((process.env.TELEGRAM_DRY_RUN || 'false') === 'true') return true;
    await axios.post(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      chat_id: CHAT_ID,
      text: toTelegramText(text),
      disable_web_page_preview: false,
    });
    return true;
  } catch (err) {
    logger.error(`Telegram error: ${err.response?.data?.description || err.message}`);
    return false;
  }
}

function readAlertState() {
  try {
    if (!fs.existsSync(ALERT_STATE_PATH)) return {};
    return JSON.parse(fs.readFileSync(ALERT_STATE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeAlertState(state) {
  try {
    const dir = path.dirname(ALERT_STATE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(ALERT_STATE_PATH, JSON.stringify(state, null, 2));
  } catch {}
}

function shouldSendLevel(level) {
  if (!isConfigured() || !getNotificationsEnabled()) return false;
  return level >= getMinLevel();
}

function getDedupeKey({ type, component = 'unknown', slot = '' }) {
  return `${type}:${component}:${slot || 'noslot'}`;
}

function trackDigestEvent(state, { type, component, slot, level }) {
  if (!getDigestEnabled()) return;
  const k = `digest:${getDedupeKey({ type, component, slot })}`;
  const cur = state[k] || { count: 0, lastAt: null, level };
  cur.count += 1;
  cur.level = level;
  cur.lastAt = new Date().toISOString();
  state[k] = cur;
}

async function sendDigestIfDue({ force = false } = {}) {
  if (!isConfigured() || !getNotificationsEnabled() || !getDigestEnabled()) return false;
  const state = readAlertState();
  const now = Date.now();
  const intervalMs = getDigestHours() * 60 * 60 * 1000;
  const last = state.__digest__?.lastSentAt ? new Date(state.__digest__.lastSentAt).getTime() : 0;
  if (!force && last && (now - last) < intervalMs) return false;

  const items = Object.entries(state)
    .filter(([k]) => k.startsWith('digest:'))
    .map(([k, v]) => ({ key: k.replace(/^digest:/, ''), count: v.count || 0, lastAt: v.lastAt || null, level: v.level || LEVELS.INFO }))
    .filter((x) => x.count > 0 && x.level >= LEVELS.WARNING)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  if (items.length === 0) return false;

  const lines = items.map((x) => `• ${escapeHtml(x.key)}: ${x.count}`).join('\n');
  const text =
    `🧾 <b>Digest Telegram</b>\n\n` +
    `${lines}\n\n` +
    getDashboardLink();

  const sent = await sendMessage(text);
  if (!sent) return false;
  state.__digest__ = { lastSentAt: new Date(now).toISOString() };
  for (const it of items) {
    delete state[`digest:${it.key}`];
  }
  writeAlertState(state);
  return true;
}

async function sendAlertWithCooldown(key, text, cooldownMinutes = null, { level = LEVELS.ERROR, type = 'alert', component = 'unknown', slot = '' } = {}) {
  if (!shouldSendLevel(level)) {
    const state = readAlertState();
    trackDigestEvent(state, { type, component, slot, level });
    writeAlertState(state);
    return false;
  }
  const now = Date.now();
  const state = readAlertState();
  const cooldown = cooldownMinutes === null ? getCooldownMinutes() : cooldownMinutes;
  const lastSent = state[key]?.lastSentAt ? new Date(state[key].lastSentAt).getTime() : 0;
  if (lastSent && (now - lastSent) < cooldown * 60 * 1000) {
    const cur = state[key] || {};
    cur.lastSentAt = cur.lastSentAt || new Date(lastSent).toISOString();
    cur.suppressed = (cur.suppressed || 0) + 1;
    cur.lastSuppressedAt = new Date(now).toISOString();
    state[key] = cur;
    trackDigestEvent(state, { type, component, slot, level });
    writeAlertState(state);
    return false;
  }

  const suppressed = state[key]?.suppressed || 0;
  const finalText = suppressed > 0 ? `${text}\n\n(Repetido ${suppressed} veces en cooldown)` : text;
  const sent = await sendMessage(finalText);
  if (!sent) return false;
  state[key] = { lastSentAt: new Date(now).toISOString(), suppressed: 0, level, type, component, slot };
  writeAlertState(state);
  return true;
}

function getDashboardLink(label = 'Ver dashboard') {
  return `📈 <a href="${DASHBOARD_URL}">${label}</a>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toTelegramText(value) {
  return String(value || '')
    .replace(/<a\s+href="([^"]+)">([^<]*)<\/a>/gi, '$2: $1')
    .replace(/<\/?(b|i|code)>/gi, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/**
 * Notificación cuando un vídeo se publica correctamente.
 */
async function notifyVideoPublished({ script, results, errors, videoId }) {
  if (!isConfigured()) return;

  const ytResult = results.find((r) => r.platform === 'youtube');
  const ttResult = results.find((r) => r.platform === 'tiktok');

  const score = script.viralityScore ?? '—';
  const topic = script.topic ?? '—';
  const hook = script.hook ?? '';

  // Líneas de plataformas publicadas
  const platformLines = [];
  if (ytResult?.url) {
    platformLines.push(`🎬 <b>YouTube:</b> <a href="${ytResult.url}">${ytResult.url}</a>`);
  }
  if (ttResult?.publishId) {
    platformLines.push(`🎵 <b>TikTok:</b> publicado (ID: ${ttResult.publishId})`);
  }
  if (errors.length > 0) {
    errors.forEach((e) => platformLines.push(`⚠️ ${e.platform}: ${e.error}`));
  }

  const text =
    `✅ <b>Vídeo publicado</b>\n\n` +
    `🧠 <i>${escapeHtml(hook)}</i>\n\n` +
    `🆔 <code>${videoId}</code>\n` +
    `📊 Viralidad: <b>${score}/100</b>  |  Topic: ${escapeHtml(topic)}\n\n` +
    (platformLines.length ? platformLines.join('\n') + '\n\n' : '') +
    getDashboardLink('Abrir dashboard');

  await sendAlertWithCooldown(
    getDedupeKey({ type: 'video_published', component: 'publisher', slot: videoId }),
    text,
    getCooldownMinutes(),
    { level: LEVELS.INFO, type: 'video_published', component: 'publisher', slot: videoId },
  );
}

/**
 * Notificación cuando un job falla.
 */
async function notifyJobFailed({ jobId, error }) {
  if (!isConfigured()) return;
  const text =
    `❌ <b>Error generando vídeo</b>\n\n` +
    `Job: <code>${jobId}</code>\n` +
    `Error: ${error}\n\n` +
    getDashboardLink();
  await sendAlertWithCooldown(
    getDedupeKey({ type: 'job_failed', component: 'generation', slot: jobId }),
    text,
    getCooldownMinutes(),
    { level: LEVELS.ERROR, type: 'job_failed', component: 'generation', slot: jobId },
  );
}

/**
 * Notificación cuando se completa la investigación viral.
 */
async function notifyResearchComplete({ totalVideos, newHooks }) {
  if (!isConfigured()) return;
  const text =
    `🔍 <b>Investigación viral completada</b>\n\n` +
    `📹 Vídeos analizados: ${totalVideos}\n` +
    `🪝 Nuevos hooks añadidos: ${newHooks}\n\n` +
    `El generador ha sido actualizado con datos reales.\n` +
    `📈 <a href="${DASHBOARD_URL}/research">Ver insights</a>`;
  await sendAlertWithCooldown(
    getDedupeKey({ type: 'research_complete', component: 'research', slot: '' }),
    text,
    getCooldownMinutes(),
    { level: LEVELS.INFO, type: 'research_complete', component: 'research', slot: '' },
  );
}

/**
 * Notificación cuando un slot de publicación queda vacío.
 * @param {'no_videos'|'discarded'|'publish_error'} reason
 * @param {{ discards?: Array<{reason,detail}>, error?: string, slot?: string }} detail
 */
async function notifySlotFailed({ reason, discards = [], error = null, slot = '' }) {
  if (!isConfigured()) return;

  const slotLabel = slot ? ` (slot ${slot})` : '';

  let text = '';

  if (reason === 'no_videos') {
    text =
      `⚠️ <b>Slot sin vídeo${slotLabel}</b>\n\n` +
      `No había ningún vídeo listo en la cola.\n` +
      `El generador debería haber preparado uno antes.\n\n` +
      getDashboardLink();

  } else if (reason === 'discarded') {
    const lines = discards.map(d => `• <b>${escapeHtml(d.reason)}</b>: ${escapeHtml(d.detail)}`).join('\n');
    text =
      `🚫 <b>Vídeo(s) descartados${slotLabel}</b>\n\n` +
      `${discards.length} candidato(s) rechazados por el quality gate:\n` +
      `${lines}\n\n` +
      getDashboardLink();

  } else if (reason === 'publish_error') {
    text =
      `❌ <b>Error al publicar${slotLabel}</b>\n\n` +
      `${error}\n\n` +
      getDashboardLink();
  }

  if (text) {
    await sendAlertWithCooldown(
      getDedupeKey({ type: `slot_failed:${reason}`, component: 'publish', slot }),
      text,
      getCooldownMinutes(),
      { level: LEVELS.CRITICAL, type: `slot_failed:${reason}`, component: 'publish', slot },
    );
  }
}

async function notifyQueueLow({ readyCount, minReady, inPipeline, reason = 'queue_low', slot = '', minutesUntilSlot = null }) {
  const text =
    `⚠️ <b>Cola operativa baja</b>\n\n` +
    `Ready: <b>${readyCount}</b> / mínimo ${minReady}\n` +
    `En pipeline: ${inPipeline}\n` +
    `Motivo: ${escapeHtml(reason)}\n\n` +
    getDashboardLink();

  const beforeSlot = typeof minutesUntilSlot === 'number' && minutesUntilSlot >= 0 && minutesUntilSlot <= 90;
  const shouldTelegram = beforeSlot && readyCount < 2;
  const level = shouldTelegram ? LEVELS.ERROR : LEVELS.WARNING;

  await sendAlertWithCooldown(
    getDedupeKey({ type: `queue_low:${reason}`, component: 'queue', slot: slot || '' }),
    text,
    getCooldownMinutes(),
    { level, type: `queue_low:${reason}`, component: 'queue', slot: slot || '' },
  );
}

async function notifyCandidateDiscarded({ videoId, reasons = [], fallbackAttempted = false }) {
  const text =
    `🚫 <b>Render inválido descartado</b>\n\n` +
    `Vídeo: <code>${videoId}</code>\n` +
    `${reasons.map((reason) => `• ${escapeHtml(reason)}`).join('\n')}\n\n` +
    `Top-up disparado: ${fallbackAttempted ? 'sí' : 'no'}\n\n` +
    getDashboardLink();
  await sendAlertWithCooldown(
    getDedupeKey({ type: 'discarded', component: 'quality_gate', slot: videoId }),
    text,
    getCooldownMinutes(),
    { level: LEVELS.WARNING, type: 'discarded', component: 'quality_gate', slot: videoId },
  );
}

async function notifyGenerationStalled({ reason, attempts = null }) {
  const attemptLine = attempts ? `Intentos agotados: ${attempts}\n` : '';
  const text =
    `❌ <b>Generación atascada</b>\n\n` +
    `${attemptLine}` +
    `Motivo: ${escapeHtml(reason)}\n\n` +
    getDashboardLink();
  await sendAlertWithCooldown(
    getDedupeKey({ type: `generation_stalled:${reason}`, component: 'generation', slot: '' }),
    text,
    getCooldownMinutes(),
    { level: LEVELS.CRITICAL, type: `generation_stalled:${reason}`, component: 'generation', slot: '' },
  );
}

async function notifySystemRecovered({ scope, detail }) {
  const text =
    `✅ <b>Sistema recuperado</b>\n\n` +
    `Área: ${escapeHtml(scope)}\n` +
    `Detalle: ${escapeHtml(detail)}\n\n` +
    getDashboardLink();
  await sendAlertWithCooldown(
    getDedupeKey({ type: 'recovered', component: scope, slot: '' }),
    text,
    getCooldownMinutes(),
    { level: LEVELS.INFO, type: 'recovered', component: scope, slot: '' },
  );
}

async function notifyPipelineBlocked({ reason, detail = '' }) {
  const text =
    `🚨 <b>Bloqueo real del pipeline</b>\n\n` +
    `Motivo: ${escapeHtml(reason)}\n` +
    `${detail ? `Detalle: ${escapeHtml(detail)}\n\n` : '\n'}` +
    getDashboardLink();

  const criticalReasons = new Set(['publish_slot_missed', 'no_real_progress', 'system_stopped', 'publish_error', 'oauth_invalid', 'llm_budget_exhausted', 'render_broken', 'tts_broken']);
  const level = criticalReasons.has(reason) ? LEVELS.CRITICAL : LEVELS.WARNING;

  await sendAlertWithCooldown(
    getDedupeKey({ type: `blocked:${reason}`, component: 'pipeline', slot: '' }),
    text,
    getCooldownMinutes(),
    { level, type: `blocked:${reason}`, component: 'pipeline', slot: '' },
  );
}

module.exports = {
  notifyVideoPublished,
  notifyJobFailed,
  notifyResearchComplete,
  notifySlotFailed,
  notifyQueueLow,
  notifyCandidateDiscarded,
  notifyGenerationStalled,
  notifySystemRecovered,
  notifyPipelineBlocked,
  sendDigestIfDue,
  sendMessage,
  isConfigured,
};
