'use strict';
/**
 * slot-commercial-proxy-scorer.js
 *
 * Convierte métricas reales incompletas en señales útiles para negocio.
 * Todo proxy está documentado con su lógica y confianza.
 *
 * OBJETIVO: distinguir vídeos con views vacías de vídeos que realmente
 * construyen audiencia monetizable y avance hacia YPP.
 *
 * Inputs disponibles hoy:
 *   - views, likes, comments, shares (YouTube API)
 *   - topic, strategicRole, clusterBusinessRole (script)
 *   - traceConfidence, exactTraceAvailable (tracking)
 *   - position in batch (actualOrder, plannedOrder)
 *
 * Outputs (0-100 salvo indicado):
 *   - estimatedRetentionScore    → proxy de watch-through rate
 *   - estimatedRewatchScore      → proxy de loop/rewatch
 *   - estimatedFollowUsefulness  → probabilidad de que el viewer siga el canal
 *   - estimatedMonetizationScore → valor comercial estimado del vídeo
 *   - estimatedYppContribution   → contribución al objetivo YPP
 *   - usefulViews                → views ponderadas por calidad
 *   - engagementQualityScore     → calidad del engagement normalizada
 *   - commercialSignalStrength   → confianza global en la lectura comercial
 */

const fs   = require('fs');
const path = require('path');

const TRACKING_DIR    = path.resolve(__dirname, '../../data/tracking');
const PROXY_REPORT_PATH = path.join(TRACKING_DIR, 'commercial-proxy-report.json');
const SLOT_RESULTS_PATH = path.join(TRACKING_DIR, 'slot-results.json');
const ATTRIBUTION_PATH  = path.join(TRACKING_DIR, 'publication-attribution.json');
const VIDEOS_PATH       = path.resolve(__dirname, '../../backend/data/videos.json');

// ─────────────────────────────────────────────
//  MULTIPLICADORES COMERCIALES POR TOPIC
//  Basados en CPM estimado para audiencia hispanohablante
//  y capacidad del topic para construir audiencia de retorno.
//  Fuente: benchmark plataformas ES/LATAM 2024.
// ─────────────────────────────────────────────
const TOPIC_COMMERCIAL_MULT = {
  productivity:      1.20,
  habits:            1.15,
  self_improvement:  1.10,
  memory:            1.10,
  procrastination:   1.05,
  cognitive_biases:  1.05,
  attention:         1.00,
  social_patterns:   0.95,
  decision_making:   1.00,
  learning:          1.05,
  emotions:          0.88,
  motivation:        0.90,
  emotional_patterns:0.88,
  relationships:     0.85,
  creativity:        0.90,
};

// Multiplicador por rol estratégico declarado
const ROLE_COMMERCIAL_MULT = {
  monetization: 1.12,
  ypp_push:     1.08,
  hybrid:       1.05,
  follow:       1.00,
  reach:        0.90,  // reach solo = views sin audiencia monetizable
};

// ─────────────────────────────────────────────
//  HEURÍSTICAS DE PROXY
// ─────────────────────────────────────────────

/**
 * estimatedRetentionScore (0-100)
 *
 * Lógica: en vídeos cortos (<20s), la retención base es alta (~50-60%)
 * porque el algoritmo los sirve hasta el final por defecto.
 * El engagement (likes + shares en especial) indica que el espectador
 * llegó al final Y decidió actuar = retención real alta.
 *
 * Fórmula: base(50) + like_boost + share_boost + comment_boost
 * Máximo teórico: 100
 * Confidence: 0.45 (sin dato real de YouTube Analytics)
 */
function _estimateRetention(views, likes, comments, shares) {
  if (views < 10) return { value: 0, confidence: 0, sourceType: 'proxy' };

  const likeRate    = likes    / views;
  const shareRate   = shares   / views;
  const commentRate = comments / views;

  // Shorts tienen retención base alta → arrancar en 45
  const base         = 45;
  const likeBoost    = Math.min(20, likeRate    * 350);  // 5% likes → +17.5
  const shareBoost   = Math.min(20, shareRate   * 700);  // 1% shares → +7
  const commentBoost = Math.min(10, commentRate * 250);  // 2% comments → +5

  const value = Math.min(100, Math.round(base + likeBoost + shareBoost + commentBoost));
  return { value, confidence: 0.45, sourceType: 'proxy' };
}

/**
 * estimatedRewatchScore (0-100)
 *
 * Lógica: rewatch se correlaciona con:
 *   1. Contenido que no se entiende en primer visionado (densidad alta)
 *   2. CTA de loop efectivo
 *   3. Comments específicos que citan el vídeo (engagement profundo)
 *
 * Proxy: comment_rate es el mejor indicador de rewatch sin Analytics.
 * Share indica spreading, no rewatch.
 * Confidence: 0.35 (señal débil sin dato real)
 */
function _estimateRewatch(views, likes, comments) {
  if (views < 10) return { value: 0, confidence: 0, sourceType: 'proxy' };

  const likeRate    = likes    / views;
  const commentRate = comments / views;

  const base         = 20;  // baseline bajo — rewatch no es universal
  const commentBoost = Math.min(40, commentRate * 800);  // 3% comments → +24
  const likeBoost    = Math.min(20, likeRate    * 150);  // 5% likes → +7.5

  const value = Math.min(100, Math.round(base + commentBoost + likeBoost));
  return { value, confidence: 0.35, sourceType: 'proxy' };
}

/**
 * estimatedFollowUsefulness (0-100)
 *
 * ¿Este vídeo convierte espectadores en seguidores que vuelven?
 *
 * Lógica:
 *   - Topics educativos de alto valor generan follows de audiencia fiel
 *   - El engagement de calidad (comments > likes > shares en ratio) indica
 *     que el espectador quiere más contenido similar
 *   - CTA implícito (nuevo sistema) da más conversión que "sígueme" bruto
 *
 * Confidence: 0.40
 */
function _estimateFollowUsefulness(views, likes, comments, topic, strategicRole) {
  if (views < 10) return { value: 0, confidence: 0, sourceType: 'proxy' };

  const topicMult = TOPIC_COMMERCIAL_MULT[topic] || 1.0;
  const roleMult  = ROLE_COMMERCIAL_MULT[strategicRole] || 1.0;
  const likeRate    = likes    / views;
  const commentRate = comments / views;

  const base         = 25;
  const engagementScore = Math.min(45, (likeRate * 250) + (commentRate * 350));
  const topicBoost   = (topicMult - 0.85) * 60;   // 1.20 → +21, 0.85 → 0
  const roleBoost    = (roleMult - 0.85) * 30;

  const value = Math.min(100, Math.round(base + engagementScore + topicBoost + roleBoost));
  return { value, confidence: 0.40, sourceType: 'mixed' };
}

/**
 * estimatedMonetizationScore (0-100)
 *
 * ¿Cuánto valor comercial genera este vídeo para el canal?
 *
 * Componentes:
 *   1. Volume proxy: views normalizadas (1000 views = buena base)
 *   2. Quality proxy: engagement rate ponderado por tipo
 *   3. Topic CPM multiplier: productivity vale más que emotions
 *   4. Batch position: slots de monetización tienen más peso directo
 *
 * Confidence: 0.45
 */
function _estimateMonetization(views, likes, comments, shares, topic, strategicRole) {
  if (views < 10) return { value: 0, confidence: 0, sourceType: 'proxy' };

  const topicMult = TOPIC_COMMERCIAL_MULT[topic] || 1.0;
  const roleMult  = ROLE_COMMERCIAL_MULT[strategicRole] || 1.0;
  const engRate   = (likes + comments + shares) / views;

  // Escala logarítmica de views (1000→40, 5000→60, 10000→75, 50000→95)
  const viewScore = Math.min(75, Math.log10(Math.max(views, 1)) * 25);
  // Calidad del engagement (max 25 puntos)
  const qualScore = Math.min(25, engRate * 500);

  const raw   = (viewScore + qualScore) * topicMult * roleMult;
  const value = Math.min(100, Math.round(raw));

  return { value, confidence: 0.45, sourceType: 'mixed' };
}

/**
 * estimatedYppContribution (0-100)
 *
 * ¿Cuánto aporta este vídeo al objetivo YPP?
 *
 * YPP Shorts: 3.000.000 visualizaciones en 90 días (no watch hours)
 * YPP Classic: 1000 subs + 4000 horas watch time en 12 meses
 *
 * Proxy:
 *   - Views son la métrica principal para Shorts YPP
 *   - Follows estimados contribuyen a subs (objetivo más largo)
 *   - Engagement alto = distribución orgánica extendida = más views futuras
 *
 * Confidence: 0.50 (relación más directa con métricas reales)
 */
function _estimateYppContribution(views, likes, comments, shares, followUsefulness) {
  if (views < 10) return { value: 0, confidence: 0, sourceType: 'proxy' };

  // 3M views en 90 días = objetivo. 1 vídeo con 1000 views = 0.033% del objetivo
  const viewsContrib    = Math.min(50, (views / 3000000) * 100 * 50);  // escala a 50 pts max
  const followContrib   = Math.min(25, followUsefulness * 0.25);         // subs indirectos
  const engRate         = (likes + comments + shares) / views;
  const viralBoost      = Math.min(25, engRate * 600);                   // boost si viral

  const value = Math.min(100, Math.round(viewsContrib + followContrib + viralBoost));
  return { value, confidence: 0.50, sourceType: 'mixed' };
}

/**
 * usefulViews
 *
 * Views ponderadas por calidad comercial.
 * Un vídeo con 5000 views y 3% engagement vale más que uno con
 * 10000 views y 0.2% engagement para el objetivo de monetización.
 *
 * Fórmula ponderada orientada a monetización:
 *   - retention proxy:       35% (tiempo real consumido)
 *   - follow usefulness:     30% (audiencia de retorno)
 *   - monetization proxy:    20% (valor CPM directo)
 *   - ypp contribution:      15% (avance YPP)
 */
function _calcUsefulViews(views, retention, followUsefulness, monetization, ypp) {
  const weight = (
    (retention       * 0.35) +
    (followUsefulness* 0.30) +
    (monetization    * 0.20) +
    (ypp             * 0.15)
  ) / 100;

  return parseFloat((views * weight).toFixed(2));
}

/**
 * engagementQualityScore (0-100)
 *
 * Normaliza el engagement rate a una escala de 0-100
 * con sensibilidad diferenciada por tipo de acción.
 *
 * Shares > comments > likes en peso comercial.
 * Un share indica que el contenido se consideró suficientemente
 * valioso para distribuir — señal más fuerte que un like pasivo.
 */
function _calcEngagementQuality(views, likes, comments, shares) {
  if (views < 10) return 0;
  const weighted = (likes * 1) + (comments * 2.5) + (shares * 4);
  const rate = weighted / views;
  // 3% weighted rate = excellent, 1% = good, 0.3% = average
  return Math.min(100, Math.round(rate * 1200));
}

/**
 * commercialSignalStrength (0-1)
 *
 * Confianza global en los proxies calculados.
 * Depende de:
 *   - Cantidad de views (pocos → señal ruidosa)
 *   - Si hay traceConfidence (trazabilidad exacta)
 *   - Si el slot tiene exactTraceAvailable
 */
function _calcSignalStrength(views, traceConfidence, exactTrace) {
  let strength = 0;

  // Volumen mínimo para señal fiable
  if (views >= 1000) strength += 0.40;
  else if (views >= 300) strength += 0.25;
  else if (views >= 100) strength += 0.15;
  else strength += 0.05;

  // Trazabilidad de slot
  if (exactTrace)         strength += 0.35;
  else if (traceConfidence > 0.7) strength += 0.20;
  else if (traceConfidence > 0.4) strength += 0.10;

  // Base de confianza de proxies
  strength += 0.25;

  return parseFloat(Math.min(1, strength).toFixed(2));
}

// ─────────────────────────────────────────────
//  FUNCIÓN PRINCIPAL
// ─────────────────────────────────────────────

/**
 * Genera el commercial-proxy-report.json con señales comerciales
 * para todos los slot-results disponibles.
 *
 * @returns {Object} payload guardado
 */
function buildCommercialProxyReport() {
  fs.mkdirSync(TRACKING_DIR, { recursive: true });

  const slotResults  = _readJson(SLOT_RESULTS_PATH, { slotResults: [] }).slotResults || [];
  const attributions = _readJson(ATTRIBUTION_PATH, { publications: [] }).publications || [];
  const videos       = _readJson(VIDEOS_PATH, []);

  const report = slotResults.map((slot) => {
    const pub   = attributions.find(p => p.slotId === slot.slotId || p.publishedVideoId === slot.publishedVideoId) || {};
    const video = videos.find(v => v.id === slot.publishedVideoId) || {};
    const script = video.script_json || {};

    const views    = slot.views    || 0;
    const likes    = slot.likes    || 0;
    const comments = slot.comments || 0;
    const shares   = slot.shares   || 0;
    const topic    = script.topic  || pub.actualCluster || slot.actualCluster || 'unknown';
    const role     = pub.actualRole || slot.actualRole  || script.strategicRole || 'reach';
    const traceConf = slot.traceConfidence || pub.traceConfidence || 0;
    const exactTrace = slot.exactTraceAvailable || pub.exactTraceAvailable || false;

    const retention    = _estimateRetention(views, likes, comments, shares);
    const rewatch      = _estimateRewatch(views, likes, comments);
    const followUtil   = _estimateFollowUsefulness(views, likes, comments, topic, role);
    const monetization = _estimateMonetization(views, likes, comments, shares, topic, role);
    const ypp          = _estimateYppContribution(views, likes, comments, shares, followUtil.value);
    const usefulViews  = _calcUsefulViews(views, retention.value, followUtil.value, monetization.value, ypp.value);
    const engQuality   = _calcEngagementQuality(views, likes, comments, shares);
    const signalStr    = _calcSignalStrength(views, traceConf, exactTrace);

    // businessValue: métrica compuesta para comparar con views brutas
    const businessValue = parseFloat((
      (usefulViews         * 0.40) +
      (monetization.value  * 0.35) +
      (ypp.value           * 0.25)
    ).toFixed(2));

    return {
      slotId:              slot.slotId     || null,
      publishedVideoId:    slot.publishedVideoId || null,
      batchId:             slot.batchId    || pub.batchId || null,
      variantId:           slot.videoRecord?.abVariantId || pub.variantId || null,
      topic,
      strategicRole:       role,
      views,
      likes,
      comments,
      shares,
      usefulViews,
      engagementQualityScore:             engQuality,
      estimatedRetentionScore:            retention.value,
      estimatedRewatchScore:              rewatch.value,
      estimatedFollowUsefulness:          followUtil.value,
      estimatedMonetizationOutcomeScore:  monetization.value,
      estimatedYppContributionScore:      ypp.value,
      businessValue,
      commercialSignalStrength:           signalStr,
      proxyConfidence:                    parseFloat(((retention.confidence + followUtil.confidence + monetization.confidence + ypp.confidence) / 4).toFixed(2)),
      sourceType:          views > 0 ? 'mixed' : 'empty',
      roleSequenceContribution: _roleSequenceContribution(role, pub.actualOrder),
      exactTraceAvailable: exactTrace,
      scoredAt:            new Date().toISOString(),
    };
  });

  // Ordenar por businessValue desc
  report.sort((a, b) => b.businessValue - a.businessValue);

  const avgBusinessValue = report.length
    ? parseFloat((report.reduce((s, r) => s + r.businessValue, 0) / report.length).toFixed(2))
    : 0;

  const payload = {
    generatedAt:     new Date().toISOString(),
    totalSlots:      report.length,
    avgBusinessValue,
    topByBusiness:   report.slice(0, 3).map(r => ({ slotId: r.slotId, views: r.views, businessValue: r.businessValue, topic: r.topic })),
    report,
  };

  fs.writeFileSync(PROXY_REPORT_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * Devuelve el proxy score para un publishedVideoId concreto (útil para checks inline).
 */
function getProxyScoreForVideo(publishedVideoId) {
  const report = _readJson(PROXY_REPORT_PATH, { report: [] }).report || [];
  return report.find(r => r.publishedVideoId === publishedVideoId) || null;
}

// ─────────────────────────────────────────────
//  HELPER: roleSequenceContribution
//  ¿El rol de este slot en la secuencia aporta valor?
//  Modelo: reach → follow → monetization es la secuencia óptima.
// ─────────────────────────────────────────────
function _roleSequenceContribution(role, order) {
  // Sin orden → neutral
  if (!order) return 0;

  // Secuencia óptima: primer slot = reach, ultimo = monetización
  if (role === 'reach'        && order <= 2)  return  8;
  if (role === 'follow'       && order === 2) return  6;
  if (role === 'follow'       && order === 3) return  8;
  if (role === 'monetization' && order >= 3)  return 12;
  if (role === 'ypp_push'     && order >= 2)  return 10;
  if (role === 'hybrid'       && order === 2) return  7;
  // Mal ordenado
  if (role === 'monetization' && order === 1) return -5;
  if (role === 'reach'        && order >= 4)  return -3;
  return 0;
}

function _readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return fallback; }
}

module.exports = {
  buildCommercialProxyReport,
  getProxyScoreForVideo,
  PROXY_REPORT_PATH,
  // Exportar heurísticas para uso en otros módulos
  _estimateRetention,
  _estimateFollowUsefulness,
  _estimateMonetization,
  _estimateYppContribution,
  _calcUsefulViews,
  _calcEngagementQuality,
  TOPIC_COMMERCIAL_MULT,
};
