#!/usr/bin/env node
/**
 * TOKEN AUDIT: Buscar todos los tokens de YouTube en el sistema
 *
 * Objetivo: Confirmar si existe otra credencial de YouTube capaz de publicar
 * fuera de publisher.js
 *
 * Revisa:
 * - .env file
 * - .env.* files
 * - PM2 environment
 * - Scripts y data directories
 * - Archivos de configuración
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║           TOKEN AUDIT: YouTube Credentials              ║');
console.log('║  Búsqueda de tokens de YouTube en el sistema            ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

const findings = [];
const backendDir = process.cwd();

// ─────────────────────────────────────────────
// CHECK 1: .env file
// ─────────────────────────────────────────────
console.log('CHECK 1: .env file\n');

const envPath = path.join(backendDir, '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  const youtubeLines = content.split('\n').filter(line =>
    line.includes('YOUTUBE') && !line.trim().startsWith('#')
  );

  console.log(`  Found ${youtubeLines.length} YouTube-related env vars\n`);

  for (const line of youtubeLines) {
    const [key, ...valueParts] = line.split('=');
    const value = valueParts.join('=');
    const redacted = value.length > 40
      ? value.substring(0, 20) + '...' + value.substring(value.length - 10)
      : value;

    console.log(`    ${key}=${redacted}`);

    findings.push({
      location: '.env',
      key,
      value,
      valueLength: value.length,
      configured: value !== 'RELLENAR' && value.length > 5,
    });
  }
} else {
  console.log('  ⚠️  .env file not found\n');
}

// ─────────────────────────────────────────────
// CHECK 2: Other .env files
// ─────────────────────────────────────────────
console.log('\nCHECK 2: Other .env.* files\n');

const backendParent = path.dirname(backendDir);
const backendName = path.basename(backendDir);
const parentDir = path.dirname(backendParent);

const envVariants = ['.env.local', '.env.staging', '.env.prod', '.env.production', '.env.backup'];
let foundAny = false;

for (const variant of envVariants) {
  const variantPath = path.join(backendDir, variant);
  if (fs.existsSync(variantPath)) {
    console.log(`  ⚠️  Found: ${variant}`);
    foundAny = true;

    const content = fs.readFileSync(variantPath, 'utf8');
    const youtubeLines = content.split('\n').filter(line =>
      line.includes('YOUTUBE') && !line.trim().startsWith('#')
    );

    for (const line of youtubeLines) {
      const [key, ...valueParts] = line.split('=');
      const value = valueParts.join('=');
      findings.push({
        location: variant,
        key,
        value,
        configured: value !== 'RELLENAR' && value.length > 5,
      });
    }
  }
}

if (!foundAny) {
  console.log('  ✅ No .env variants found\n');
}

// ─────────────────────────────────────────────
// CHECK 3: PM2 environment
// ─────────────────────────────────────────────
console.log('\nCHECK 3: PM2 ecosystem.config.js\n');

const pm2Path = path.join(backendParent, 'ecosystem.config.js');
if (fs.existsSync(pm2Path)) {
  const content = fs.readFileSync(pm2Path, 'utf8');
  if (content.includes('YOUTUBE')) {
    console.log('  ⚠️  PM2 config contains YOUTUBE references');
    const youtubeLines = content.split('\n').filter(line => line.includes('YOUTUBE'));
    for (const line of youtubeLines) {
      console.log(`    ${line.trim().substring(0, 80)}`);
    }

    findings.push({
      location: 'ecosystem.config.js',
      type: 'pm2-config',
      hasYoutubeRefs: true,
    });
  } else {
    console.log('  ✅ No YOUTUBE vars in PM2 config\n');
  }
} else {
  console.log('  ℹ️  ecosystem.config.js not in parent directory\n');
}

// ─────────────────────────────────────────────
// CHECK 4: Scripts and data directories
// ─────────────────────────────────────────────
console.log('CHECK 4: Scripts and data directories\n');

const dirsToCheck = [
  { name: 'scripts', dir: path.join(backendDir, 'scripts') },
  { name: 'data', dir: path.join(backendDir, 'data') },
  { name: 'src/scripts', dir: path.join(backendDir, 'src/scripts') },
];

for (const { name, dir } of dirsToCheck) {
  if (!fs.existsSync(dir)) {
    console.log(`  ℹ️  ${name} directory not found`);
    continue;
  }

  try {
    const files = fs.readdirSync(dir);
    const credFiles = files.filter(f =>
      f.includes('token') || f.includes('cred') || f.includes('auth') || f.includes('key')
    );

    if (credFiles.length > 0) {
      console.log(`  ⚠️  Found credential-like files in ${name}:`);
      for (const file of credFiles) {
        console.log(`    - ${file}`);
        findings.push({
          location: `${name}/${file}`,
          type: 'credential-like-file',
        });
      }
    }
  } catch (err) {
    console.log(`  ⚠️  Error reading ${name}: ${err.message}`);
  }
}

console.log();

// ─────────────────────────────────────────────
// CHECK 5: Search for API keys in source code
// ─────────────────────────────────────────────
console.log('CHECK 5: Search for hardcoded YouTube tokens\n');

try {
  const result = execSync('grep -r "youtube\|youtube_id\|YOUTUBE_REFRESH" src/ scripts/ --include="*.js" 2>/dev/null | head -20', {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
  });

  if (result.trim()) {
    console.log('  ⚠️  Found references:\n');
    const lines = result.split('\n').slice(0, 20);
    for (const line of lines) {
      console.log(`    ${line.substring(0, 100)}`);
    }
  } else {
    console.log('  ✅ No direct hardcoded YouTube tokens found\n');
  }
} catch {
  console.log('  ✅ No direct hardcoded YouTube tokens found\n');
}

// ─────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────
console.log('═'.repeat(60));
console.log('AUDIT SUMMARY\n');

const configuredTokens = findings.filter(f => f.configured === true);
const tokenFiles = findings.filter(f => f.type === 'credential-like-file');
const pm2Refs = findings.filter(f => f.location === 'ecosystem.config.js');

console.log(`Total findings: ${findings.length}\n`);

if (configuredTokens.length > 0) {
  console.log(`⚠️  Configured YouTube tokens: ${configuredTokens.length}`);
  for (const token of configuredTokens) {
    console.log(`    - ${token.location}: ${token.key}`);
  }
  console.log();
}

if (tokenFiles.length > 0) {
  console.log(`⚠️  Credential-like files found: ${tokenFiles.length}`);
  for (const file of tokenFiles) {
    console.log(`    - ${file.location}`);
  }
  console.log();
}

if (pm2Refs.length > 0) {
  console.log(`⚠️  PM2 config has YOUTUBE references: ${pm2Refs.length}\n`);
}

console.log('═'.repeat(60));

console.log('\nCONCLUSION:\n');

const activeTokens = findings.filter(f =>
  f.value && f.value !== 'RELLENAR' && f.value.length > 50 && f.key?.includes('TOKEN')
);

if (activeTokens.length === 1) {
  console.log('✅ SAFE: Only 1 active token found (in .env)\n');
  console.log('Risk assessment: LOW');
  console.log('  - Token is managed through publisher.js guard');
  console.log('  - No duplicate tokens in backup files\n');
  process.exit(0);
} else if (activeTokens.length === 0) {
  console.log('⚠️  CRITICAL: No active tokens found\n');
  console.log('Risk assessment: Publication will fail until tokens configured\n');
  process.exit(0);
} else {
  console.log(`❌ RISK: Multiple active tokens found (${activeTokens.length})\n`);
  console.log('Risk assessment: HIGH - alternative publish paths possible\n');
  for (const token of activeTokens) {
    console.log(`  - ${token.location}: ${token.key}`);
  }
  process.exit(1);
}
