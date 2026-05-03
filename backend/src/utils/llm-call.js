const logger = require('./logger');
const { canMakeLLMCall, enforceEmergencyMode, incrementUsage, getRemainingCalls } = require('./llm-usage-tracker');

function getLlmTimeoutMs() {
  return parseInt(process.env.LLM_TIMEOUT_MS || '35000', 10) || 35000;
}

function createLlmMetrics() {
  return {
    llm_total_calls: 0,
    llm_parse_fail: false,
    llm_recovery_used: false,
    llm_hard_fail: false,
    emergency_fallback_used: false,
    llm_schema_fail: false,
    llm_truncated_suspected: false,
  };
}

function mergeLlmMetrics(target = {}, extra = {}) {
  target.llm_total_calls = (target.llm_total_calls || 0) + (Number.isFinite(extra.llm_total_calls) ? extra.llm_total_calls : 0);
  target.llm_parse_fail = Boolean(target.llm_parse_fail || extra.llm_parse_fail);
  target.llm_recovery_used = Boolean(target.llm_recovery_used || extra.llm_recovery_used);
  target.llm_hard_fail = Boolean(target.llm_hard_fail || extra.llm_hard_fail);
  target.emergency_fallback_used = Boolean(target.emergency_fallback_used || extra.emergency_fallback_used);
  target.llm_schema_fail = Boolean(target.llm_schema_fail || extra.llm_schema_fail);
  target.llm_truncated_suspected = Boolean(target.llm_truncated_suspected || extra.llm_truncated_suspected);
  return target;
}

function classifyLlmFailure(error) {
  if (!error) return 'unknown';
  if (error.isLlmTimeout || error.code === 'LLM_TIMEOUT') return 'timeout';
  if (error.llm_schema_fail || /schema|missing/i.test(error.message || '')) return 'schema';
  if (error.llm_parse_fail || /invalid JSON|JSON parse/i.test(error.message || '')) return 'parse';
  return 'hard_fail';
}

function markLlmHardFail(metrics, error) {
  metrics.llm_hard_fail = true;
  metrics.llm_failure_reason = classifyLlmFailure(error);
  if (error?.llm_parse_fail) metrics.llm_parse_fail = true;
  if (error?.llm_schema_fail) metrics.llm_schema_fail = true;
  if (error?.llm_truncated_suspected) metrics.llm_truncated_suspected = true;
  return metrics;
}

function attachLlmMetrics(target, metrics = {}) {
  if (!target || typeof target !== 'object') return target;
  target.llmMetrics = { ...(target.llmMetrics || {}), ...metrics };
  target.usedRecovery = Boolean(target.llmMetrics.llm_recovery_used);
  return target;
}

async function callAnthropicWithTimeout(client, payload, { label = 'llm-call', timeoutMs = getLlmTimeoutMs() } = {}) {
  // PRE-CHECK: ¿Límite de llamadas alcanzado?
  if (process.env.EMERGENCY_NO_LLM_MODE === 'true') {
    const error = new Error(`${label}: LLM DISABLED — daily limit reached`);
    error.code = 'LLM_LIMIT_REACHED';
    logger.error(error.message);
    throw error;
  }

  if (!canMakeLLMCall()) {
    enforceEmergencyMode();
    const error = new Error(`${label}: LLM BLOCKED — daily limit reached (${getRemainingCalls()} remaining)`);
    error.code = 'LLM_LIMIT_REACHED';
    logger.error(error.message);
    throw error;
  }

  let timer = null;

  try {
    // Hacer la llamada
    const result = await Promise.race([
      client.messages.create(payload),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${label}: LLM timeout after ${timeoutMs}ms`);
          error.code = 'LLM_TIMEOUT';
          error.isLlmTimeout = true;
          reject(error);
        }, timeoutMs);
      }),
    ]);

    // Incrementar contador DESPUÉS de éxito
    incrementUsage(label);
    logger.info(`${label}: LLM call success | remaining: ${getRemainingCalls()}`);

    return result;
  } catch (error) {
    if (error?.isLlmTimeout) {
      logger.error(`${label}: LLM timeout after ${timeoutMs}ms`);
    } else if (error?.code === 'LLM_LIMIT_REACHED') {
      // No incrementar contador si alcanzamos límite
      throw error;
    } else {
      // Otros errores aún cuentan como llamada
      incrementUsage(label);
    }
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

module.exports = {
  callAnthropicWithTimeout,
  createLlmMetrics,
  mergeLlmMetrics,
  getLlmTimeoutMs,
  classifyLlmFailure,
  markLlmHardFail,
  attachLlmMetrics,
};
