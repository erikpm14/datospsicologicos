const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('════════════════════════════════════════════════════');
console.log('🔍 WHISPER AVAILABILITY CHECK');
console.log('════════════════════════════════════════════════════\n');

const checks = {
  python: false,
  pythonVersion: null,
  fasterWhisper: false,
  whisperCpp: false,
  whisperCppPath: null,
};

// Check 1: Python availability
console.log('1️⃣  Checking Python...');
try {
  const pythonVersion = execSync('python --version 2>&1 || python3 --version 2>&1', { encoding: 'utf-8' }).trim();
  checks.python = true;
  checks.pythonVersion = pythonVersion;
  console.log(`   ✅ ${pythonVersion}`);
} catch (err) {
  console.log(`   ❌ Python not found`);
}

// Check 2: faster-whisper
if (checks.python) {
  console.log('\n2️⃣  Checking faster-whisper...');
  try {
    const result = execSync('python -c "import faster_whisper; print(faster_whisper.__version__)" 2>&1 || python3 -c "import faster_whisper; print(faster_whisper.__version__)" 2>&1', { encoding: 'utf-8' }).trim();
    checks.fasterWhisper = true;
    console.log(`   ✅ faster-whisper ${result} installed`);
  } catch (err) {
    console.log(`   ❌ faster-whisper not installed`);
    console.log(`      Install with: pip install faster-whisper`);
  }
}

// Check 3: whisper.cpp binary
console.log('\n3️⃣  Checking whisper.cpp...');
const possiblePaths = [
  'C:\\Users\\Erik\\whisper.cpp\\main.exe',
  'C:\\Program Files\\whisper.cpp\\main.exe',
  '/usr/local/bin/whisper',
  './whisper.cpp/main',
];

for (const binPath of possiblePaths) {
  if (fs.existsSync(binPath)) {
    checks.whisperCpp = true;
    checks.whisperCppPath = binPath;
    console.log(`   ✅ whisper.cpp found at: ${binPath}`);
    break;
  }
}

if (!checks.whisperCpp) {
  console.log(`   ❌ whisper.cpp not found in typical locations`);
  console.log(`      Install from: https://github.com/ggerganov/whisper.cpp`);
}

// Summary
console.log('\n════════════════════════════════════════════════════');
console.log('📊 SUMMARY\n');

console.log('Available engines:');
if (checks.fasterWhisper) {
  console.log('  🟢 faster-whisper (RECOMMENDED — fastest)');
}
if (checks.whisperCpp) {
  console.log(`  🟢 whisper.cpp (${checks.whisperCppPath})`);
}
if (!checks.fasterWhisper && !checks.whisperCpp) {
  console.log('  🔴 No Whisper engines available');
  console.log('  ⚠️  Will use detectVoiceSegments fallback');
}

console.log('\n════════════════════════════════════════════════════');
console.log('RECOMMENDATION:\n');

if (checks.fasterWhisper) {
  console.log('✅ Use faster-whisper (Python)');
  console.log('   Engine: faster-whisper');
  console.log('   Speed: ~5-15s for 30s audio');
  console.log('   Quality: Excellent word-level timestamps');
} else if (checks.whisperCpp) {
  console.log('✅ Use whisper.cpp');
  console.log(`   Engine: whisper.cpp (${checks.whisperCppPath})`);
  console.log('   Speed: ~2-5s for 30s audio');
  console.log('   Quality: Excellent word-level timestamps');
} else {
  console.log('⚠️  No Whisper available — using fallback');
  console.log('   Engine: detectVoiceSegments');
  console.log('   Speed: Fast');
  console.log('   Quality: Good but less precise');
}

console.log('\n════════════════════════════════════════════════════\n');

// Export for use in code
module.exports = checks;
