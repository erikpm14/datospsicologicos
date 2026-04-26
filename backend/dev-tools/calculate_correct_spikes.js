const duration = 26.0; // segundos

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log('  CÁLCULO CORRECTO: STRONG SPIKE 60-70% de duración');
console.log('═══════════════════════════════════════════════════════════════════\n');

const sixty_percent = duration * 0.60;
const seventy_percent = duration * 0.70;

console.log(`Duration total:        ${duration}s`);
console.log(`60% de ${duration}s:     ${sixty_percent.toFixed(2)}s`);
console.log(`70% de ${duration}s:     ${seventy_percent.toFixed(2)}s`);
console.log(`\n→ Strong spike DEBE estar entre ${sixty_percent.toFixed(2)}s y ${seventy_percent.toFixed(2)}s\n`);

console.log('NUEVA DISTRIBUCIÓN DE SEGMENTOS:');
console.log('─'.repeat(65));

const segments = [
  { name: 'HOOK', start: 0, percent: 0.13, label: '0-13% (build inicial)' },
  { name: 'OPEN_LOOP', start: 3.4, percent: 0.27, label: '13-40% (identificación)' },
  { name: 'ESCALATION', start: 7.2, percent: 0.27, label: '40-50% (tensión)' },
  { name: 'REENGAGE + STRONG SPIKE', start: 13.0, percent: 0.27, label: '50-70% (clímax)' },
  { name: 'ENDING', start: 17.5, percent: 0.30, label: '70-100% (resolución)' },
];

let currentPos = 0;
for (const seg of segments) {
  const start = currentPos;
  const duration_seg = duration * seg.percent;
  const end = start + duration_seg;
  console.log(`${seg.name.padEnd(24)} ${start.toFixed(1)}s - ${end.toFixed(1)}s (${seg.label})`);
  currentPos = end;
}

console.log('\n' + '─'.repeat(65));
console.log('STRONG SPIKE PLACEMENT:');
console.log('─'.repeat(65));

const strongSpikeTime = 17.5; // Colocado en transición reengage→ending
const strongPercent = (strongSpikeTime / duration) * 100;

console.log(`Timestamp:        ${strongSpikeTime}s`);
console.log(`Porcentaje:       ${strongPercent.toFixed(1)}% de ${duration}s`);

if (strongSpikeTime >= sixty_percent && strongSpikeTime <= seventy_percent) {
  console.log(`Estado:           ✅ VÁLIDO (dentro de 60-70%)`);
} else {
  console.log(`Estado:           ❌ INVÁLIDO (fuera de 60-70%)`);
}

console.log('\n' + '═'.repeat(65) + '\n');
