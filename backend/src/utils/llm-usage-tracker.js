const fs = require('fs');
const path = require('path');
const logger = require('./logger');

const DATA_DIR = path.resolve('./data');
const USAGE_FILE = path.join(DATA_DIR, 'llm-usage.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getTodayDate() {
  return new Date().toISOString().split('T')[0];
}

function getUsageRecord() {
  ensureDataDir();
  if (!fs.existsSync(USAGE_FILE)) {
    return { date: getTodayDate(), calls: 0 };
  }

  try {
    const data = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8'));
    const today = getTodayDate();

    // Si es un día nuevo, reiniciar contador
    if (data.date !== today) {
      return { date: today, calls: 0 };
    }

    return data;
  } catch (err) {
    logger.warn(`LLMUsageTracker: error reading usage file: ${err.message}`);
    return { date: getTodayDate(), calls: 0 };
  }
}

function saveUsageRecord(record) {
  ensureDataDir();
  try {
    fs.writeFileSync(USAGE_FILE, JSON.stringify(record, null, 2));
  } catch (err) {
    logger.error(`LLMUsageTracker: error saving usage file: ${err.message}`);
  }
}

function incrementUsage(endpoint = 'unknown') {
  const record = getUsageRecord();
  record.calls += 1;
  record.lastCall = {
    endpoint,
    timestamp: new Date().toISOString(),
  };
  saveUsageRecord(record);
  return record;
}

function canMakeLLMCall() {
  const maxCalls = parseInt(process.env.MAX_LLM_CALLS_PER_DAY || '100', 10);
  const record = getUsageRecord();

  if (record.calls >= maxCalls) {
    logger.warn(`LLM DAILY LIMIT REACHED: ${record.calls}/${maxCalls} calls`);
    return false;
  }

  return true;
}

function enforceEmergencyMode() {
  const maxCalls = parseInt(process.env.MAX_LLM_CALLS_PER_DAY || '100', 10);
  const record = getUsageRecord();

  if (record.calls >= maxCalls) {
    process.env.EMERGENCY_NO_LLM_MODE = 'true';
    logger.error(`EMERGENCY_NO_LLM_MODE ACTIVATED — daily limit reached (${record.calls}/${maxCalls})`);
    return true;
  }

  return false;
}

function getRemainingCalls() {
  const maxCalls = parseInt(process.env.MAX_LLM_CALLS_PER_DAY || '100', 10);
  const record = getUsageRecord();
  return Math.max(0, maxCalls - record.calls);
}

function getUsageStatus() {
  const maxCalls = parseInt(process.env.MAX_LLM_CALLS_PER_DAY || '100', 10);
  const record = getUsageRecord();
  const remaining = getRemainingCalls();

  return {
    date: record.date,
    calls: record.calls,
    maxCalls,
    remaining,
    percentage: Math.round((record.calls / maxCalls) * 100),
    emergencyMode: process.env.EMERGENCY_NO_LLM_MODE === 'true',
  };
}

module.exports = {
  canMakeLLMCall,
  enforceEmergencyMode,
  incrementUsage,
  getRemainingCalls,
  getUsageStatus,
  getUsageRecord,
};
