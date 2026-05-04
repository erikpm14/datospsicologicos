#!/usr/bin/env node

const { getUsageStatus } = require('../src/utils/llm-usage-tracker');

const status = getUsageStatus();

console.log('');
console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║          LLM USAGE REPORT — Anthropic API Control         ║');
console.log('╚════════════════════════════════════════════════════════════╝');
console.log('');

console.log('📊 USAGE TODAY');
console.log('- Date: ' + status.date);
console.log('- Calls: ' + status.calls + ' / ' + status.maxCalls);
console.log('- Remaining: ' + status.remaining);
console.log('- Usage: ' + status.percentage + '%');
console.log('');

console.log('🔴 STATUS');
if (status.percentage >= 100) {
  console.log('- ❌ LIMIT REACHED — LLM disabled');
  console.log('- EMERGENCY_NO_LLM_MODE: ' + status.emergencyMode);
} else if (status.percentage >= 80) {
  console.log('- 🟡 WARNING — 80% consumed');
} else if (status.percentage >= 50) {
  console.log('- 🟢 OK — 50% consumed');
} else {
  console.log('- ✓ PLENTY — ' + status.remaining + ' calls available');
}
console.log('');

console.log('════════════════════════════════════════════════════════════');
console.log('');
