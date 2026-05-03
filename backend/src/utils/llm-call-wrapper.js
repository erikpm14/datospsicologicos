const logger = require('./logger');
const {
  canMakeLLMCall,
  enforceEmergencyMode,
  incrementUsage,
  getRemainingCalls,
} = require('./llm-usage-tracker');

async function callClaudeAPI(endpoint, options = {}) {
  // Verificar si estamos en modo emergencia
  if (process.env.EMERGENCY_NO_LLM_MODE === 'true') {
    logger.error(`LLM BLOCKED: EMERGENCY_NO_LLM_MODE active`);
    throw new Error('LLM disabled: daily limit reached');
  }

  // Verificar si podemos hacer más llamadas
  if (!canMakeLLMCall()) {
    enforceEmergencyMode();
    logger.error(`LLM BLOCKED: Daily limit reached. Remaining: ${getRemainingCalls()}`);
    throw new Error('LLM daily limit reached');
  }

  // Incrementar contador ANTES de hacer la llamada
  const before = getRemainingCalls();
  incrementUsage(endpoint);
  const after = getRemainingCalls();

  logger.info(`LLM CALL [${endpoint}] | remaining: ${after}/${before + 1}`);

  // Aquí va la lógica de llamada real a Anthropic
  // (delegada al código que llama este wrapper)

  return {
    tracked: true,
    remaining: after,
    endpoint,
  };
}

// Envolvedor para Anthropic SDK
async function safeLLMCall(asyncFn, endpoint = 'unknown') {
  // Verificar pre-condición
  if (process.env.EMERGENCY_NO_LLM_MODE === 'true') {
    logger.error(`LLM BLOCKED: EMERGENCY_NO_LLM_MODE active`);
    throw new Error('LLM disabled: daily limit reached');
  }

  if (!canMakeLLMCall()) {
    enforceEmergencyMode();
    throw new Error('LLM daily limit reached');
  }

  // Ejecutar la función
  try {
    const result = await asyncFn();
    incrementUsage(endpoint);
    logger.info(`LLM SUCCESS [${endpoint}] | remaining: ${getRemainingCalls()}`);
    return result;
  } catch (err) {
    logger.error(`LLM FAILED [${endpoint}]: ${err.message}`);
    throw err;
  }
}

module.exports = {
  callClaudeAPI,
  safeLLMCall,
};
