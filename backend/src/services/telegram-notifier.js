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

function isConfigured() {
  return TOKEN && TOKEN !== 'RELLENAR' && CHAT_ID && CHAT_ID !== 'RELLENAR';
}

async function sendMessage(text) {
  if (!isConfigured()) return false;
  try {
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

async function sendAlertWithCooldown(key, text, cooldownMinutes = 60) {
  if (!isConfigured()) return false;
  const now = Date.now();
  const state = readAlertState();
  const lastSent = state[key] ? new Date(state[key]).getTime() : 0;
  if (lastSent && (now - lastSent) < cooldownMinutes * 60 * 1000) return false;
  const sent = await sendMessage(text);
  if (!sent) return false;
  state[key] = new Date(now).toISOString();
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

  await sendMessage(text);
  logger.info('Telegram: notificación enviada');
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
  await sendMessage(text);
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
  await sendMessage(text);
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

  if (text) await sendMessage(text);
}

async function notifyQueueLow({ readyCount, minReady, inPipeline, reason = 'queue_low' }) {
  const text =
    `⚠️ <b>Cola operativa baja</b>\n\n` +
    `Ready: <b>${readyCount}</b> / mínimo ${minReady}\n` +
    `En pipeline: ${inPipeline}\n` +
    `Motivo: ${escapeHtml(reason)}\n\n` +
    getDashboardLink();
  await sendAlertWithCooldown(`queue_low:${reason}`, text, parseInt(process.env.ALERT_QUEUE_LOW_COOLDOWN_MINUTES || '180', 10) || 180);
}

async function notifyCandidateDiscarded({ videoId, reasons = [], fallbackAttempted = false }) {
  const text =
    `🚫 <b>Render inválido descartado</b>\n\n` +
    `Vídeo: <code>${videoId}</code>\n` +
    `${reasons.map((reason) => `• ${escapeHtml(reason)}`).join('\n')}\n\n` +
    `Top-up disparado: ${fallbackAttempted ? 'sí' : 'no'}\n\n` +
    getDashboardLink();
  await sendAlertWithCooldown(`discarded:${videoId}`, text, parseInt(process.env.ALERT_DISCARDED_COOLDOWN_MINUTES || '240', 10) || 240);
}

async function notifyGenerationStalled({ reason, attempts = null }) {
  const attemptLine = attempts ? `Intentos agotados: ${attempts}\n` : '';
  const text =
    `❌ <b>Generación atascada</b>\n\n` +
    `${attemptLine}` +
    `Motivo: ${escapeHtml(reason)}\n\n` +
    getDashboardLink();
  await sendAlertWithCooldown(`generation_stalled:${reason}`, text, parseInt(process.env.ALERT_STALLED_COOLDOWN_MINUTES || '180', 10) || 180);
}

async function notifySystemRecovered({ scope, detail }) {
  const text =
    `✅ <b>Sistema recuperado</b>\n\n` +
    `Área: ${escapeHtml(scope)}\n` +
    `Detalle: ${escapeHtml(detail)}\n\n` +
    getDashboardLink();
  await sendAlertWithCooldown(`recovered:${scope}:${detail}`, text, parseInt(process.env.ALERT_RECOVERED_COOLDOWN_MINUTES || '120', 10) || 120);
}

async function notifyPipelineBlocked({ reason, detail = '' }) {
  const text =
    `🚨 <b>Bloqueo real del pipeline</b>\n\n` +
    `Motivo: ${escapeHtml(reason)}\n` +
    `${detail ? `Detalle: ${escapeHtml(detail)}\n\n` : '\n'}` +
    getDashboardLink();
  await sendAlertWithCooldown(`blocked:${reason}`, text, parseInt(process.env.ALERT_BLOCKED_COOLDOWN_MINUTES || '120', 10) || 120);
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
  sendMessage,
  isConfigured,
};
