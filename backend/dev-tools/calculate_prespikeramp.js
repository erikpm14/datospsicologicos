const duration = 26.0;

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  PRESPIKERAMP CALCULATION — Strong Spike Preparation');
console.log('═══════════════════════════════════════════════════════════════════\n');

const percent_50 = duration * 0.50;  // 13.0s
const percent_55 = duration * 0.55;  // 14.3s
const percent_60 = duration * 0.60;  // 15.6s
const percent_65 = duration * 0.65;  // 16.9s
const percent_70 = duration * 0.70;  // 18.2s

console.log('TIMELINE DE PREPARACIÓN AL STRONG SPIKE:');
console.log('─'.repeat(65));
console.log(`50% (13.0s) ─────┐`);
console.log(`                 ├─ ESCALATION TENSION (build)`);
console.log(`55% (14.3s) ─────┤`);
console.log(`                 ├─ SOFT SPIKE (anticipation)`);
console.log(`60% (15.6s) ─────┤`);
console.log(`                 ├─ MICRO PAUSE/SPIKE (max tension)`);
console.log(`65% (16.9s) ─────┤`);
console.log(`                 ├─ STRONG SPIKE (climax)`);
console.log(`70% (18.2s) ─────┘`);
console.log('');

console.log('SPIKE PLACEMENT REQUIREMENTS:');
console.log('─'.repeat(65));
console.log(`✓ Soft spike:      55-60% range = ${percent_55.toFixed(2)}s - ${percent_60.toFixed(2)}s`);
console.log(`✓ Micro interrupt: 60-65% range = ${percent_60.toFixed(2)}s - ${percent_65.toFixed(2)}s`);
console.log(`✓ Strong spike:    60-70% range = ${percent_60.toFixed(2)}s - ${percent_70.toFixed(2)}s`);
console.log('');

console.log('SPECIFIC TIMESTAMPS FOR 26s VIDEO:');
console.log('─'.repeat(65));
console.log(`Escalation build:      13.0s - 14.3s (50-55%) [0.3s duration]`);
console.log(`Soft spike @ 14.5s:    55% of 26s ✓ (anticipation)`);
console.log(`Micro pause/spike:     15.6s - 16.9s (60-65%) [1.3s window]`);
console.log(`Strong spike @ 17.5s:  67.3% of 26s ✓ (climax)`);
console.log('');

console.log('═══════════════════════════════════════════════════════════════════\n');
