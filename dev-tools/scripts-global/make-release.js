#!/usr/bin/env node
/**
 * make-release.js
 * Genera un ZIP limpio y versionado del proyecto listo para compartir.
 *
 * Uso:
 *   node scripts/make-release.js          (desde la raíz del proyecto)
 *   npm run release                        (desde ./backend)
 *
 * Salida:
 *   releases/datos-psicologicos-v1.0.0-2026-04-16.zip
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { spawnSync } = require('child_process');

// ─────────────────────────────────────────────────────────────────────────────
//  CONFIGURACIÓN
// ─────────────────────────────────────────────────────────────────────────────

const ROOT        = path.resolve(__dirname, '..');
const PKG         = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/package.json'), 'utf8'));
const VERSION     = PKG.version || '1.0.0';
const DATE        = new Date().toISOString().slice(0, 10);           // YYYY-MM-DD
const ZIP_NAME    = `datos-psicologicos-v${VERSION}-${DATE}`;
const RELEASE_DIR = path.join(ROOT, 'releases');
const OUT_ZIP     = path.join(RELEASE_DIR, `${ZIP_NAME}.zip`);
const TMP_DIR     = path.join(os.tmpdir(), `make-release-${Date.now()}`);

// ─────────────────────────────────────────────────────────────────────────────
//  LISTA BLANCA — qué incluir (rutas relativas a ROOT)
//  Cada entrada indica qué es y por qué se incluye.
// ─────────────────────────────────────────────────────────────────────────────

const INCLUDE = [
  // ── Backend ─────────────────────────────────────────────────────────────
  { src: 'backend/src',                   desc: 'Código fuente del servidor'         },
  { src: 'backend/package.json',          desc: 'Dependencias del backend'           },
  { src: 'backend/package-lock.json',     desc: 'Lockfile del backend'               },
  { src: 'backend/.env.example',          desc: 'Plantilla de variables de entorno'  },
  { src: 'backend/assets/fruits',         desc: 'Imágenes para FruitDrama'           },
  // Kokoro: solo el script Python y el README de instalación (sin modelos binarios)
  // Los modelos .onnx/.bin se descargan con: python -m kokoro_onnx download
  { src: 'backend/src/utils/kokoro_tts.py', desc: 'Script TTS Kokoro (incluido en src)' },

  // ── Frontend ─────────────────────────────────────────────────────────────
  { src: 'frontend/src',                  desc: 'Código fuente del dashboard React'  },
  { src: 'frontend/package.json',         desc: 'Dependencias del frontend'          },
  { src: 'frontend/package-lock.json',    desc: 'Lockfile del frontend'              },
  { src: 'frontend/index.html',           desc: 'HTML raíz del frontend'             },
  { src: 'frontend/vite.config.js',       desc: 'Configuración Vite'                 },
  { src: 'frontend/tailwind.config.js',   desc: 'Configuración Tailwind'             },
  { src: 'frontend/postcss.config.js',    desc: 'Configuración PostCSS'              },

  // ── Scripts ──────────────────────────────────────────────────────────────
  { src: 'scripts',                       desc: 'Scripts de utilidad y CI'           },

  // ── Documentación / OAuth pages ──────────────────────────────────────────
  { src: 'docs',                          desc: 'Páginas OAuth y política de privacidad' },

  // ── Assets de marca ──────────────────────────────────────────────────────
  { src: 'assets/logo_dato_psicologico.png',   desc: 'Logo del canal'              },
  { src: 'assets/banner_dato_psicologico.png', desc: 'Banner del canal'            },

  // ── Configuración de despliegue ───────────────────────────────────────────
  { src: 'ecosystem.config.js',           desc: 'Configuración PM2'                  },
  { src: 'README.md',                     desc: 'Documentación principal'            },
  { src: '.gitignore',                    desc: 'Reglas de exclusión de git'         },
];

// ─────────────────────────────────────────────────────────────────────────────
//  LISTA NEGRA — qué excluir dentro de las carpetas incluidas
// ─────────────────────────────────────────────────────────────────────────────

// Carpetas que NUNCA se copian aunque estén dentro de un directorio incluido
const SKIP_DIRS = new Set([
  'node_modules',          // dependencias instalables con npm install
  'dist',                  // frontend compilado (npm run build lo regenera)
  'build',
  '.next',
  'coverage',
  '.cache',
  'tmp', 'temp',
  'output',                // vídeos generados
  'queue',                 // estado de la cola en disco
  'logs',                  // logs de runtime
  'data',                  // estado runtime (videos.json, metrics.json, etc.)
  'releases',              // evitar auto-inclusión de zips anteriores
  '.git',
  '.claude',               // configuración interna de Claude Code
  'web_datos.psicologicos', // repo git separado para la web OAuth
  'stock-footage',         // caché de vídeos de Pexels (~2 GB) — se re-descarga automáticamente
]);

// Extensiones que NUNCA se incluyen
const SKIP_EXTS = new Set([
  '.mp4', '.avi', '.mov', '.mkv',    // vídeos (generados o caché)
  '.wav', '.mp3', '.aac',            // audio (generado)
  '.onnx', '.bin',                   // modelos ML pesados (>200 MB)
  '.log',                            // logs
  '.zip', '.tar', '.gz', '.7z',      // archivos comprimidos
  '.DS_Store',                       // macOS
]);

// Archivos concretos que NUNCA se incluyen (por nombre exacto)
const SKIP_FILES = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production',
  '.env.production.local',
  '.env.test',
  'Thumbs.db',
  'desktop.ini',
  'test_tts.wav',
  'test_es.wav',
  'test2.wav',
]);

// ─────────────────────────────────────────────────────────────────────────────
//  FUNCIONES
// ─────────────────────────────────────────────────────────────────────────────

function copyRecursive(src, dest, stats = { files: 0, skipped: 0 }) {
  const stat = fs.statSync(src);
  const name = path.basename(src);
  const ext  = path.extname(src).toLowerCase();

  if (stat.isDirectory()) {
    if (SKIP_DIRS.has(name)) {
      stats.skipped++;
      return stats;
    }
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child), stats);
    }
  } else {
    if (SKIP_FILES.has(name) || SKIP_EXTS.has(ext)) {
      stats.skipped++;
      return stats;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    stats.files++;
  }
  return stats;
}

function fmtSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n========================================');
console.log('  make-release — datos-psicologicos');
console.log('========================================\n');
console.log(`  Versión  : v${VERSION}`);
console.log(`  Fecha    : ${DATE}`);
console.log(`  Destino  : releases/${ZIP_NAME}.zip\n`);

// 1. Preparar carpetas
fs.mkdirSync(RELEASE_DIR, { recursive: true });

// Mantener la carpeta en git pero ignorar el contenido
const relGitignore = path.join(RELEASE_DIR, '.gitignore');
if (!fs.existsSync(relGitignore)) {
  fs.writeFileSync(relGitignore, '# Archivos generados automáticamente\n*.zip\n');
}

// Borrar TODOS los ZIPs anteriores (el nombre lleva fecha, sin esto se acumulan)
const oldZips = fs.readdirSync(RELEASE_DIR).filter(f => f.endsWith('.zip'));
for (const z of oldZips) {
  fs.unlinkSync(path.join(RELEASE_DIR, z));
  console.log(`  🗑  Eliminado anterior: ${z}`);
}

if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

// 2. Copiar archivos según lista blanca
console.log('  Copiando archivos...\n');
let totalFiles   = 0;
let totalSkipped = 0;
const manifest   = [];

for (const { src, desc } of INCLUDE) {
  const srcAbs  = path.join(ROOT, src);
  const destAbs = path.join(TMP_DIR, src);

  if (!fs.existsSync(srcAbs)) {
    console.log(`  -  (no existe)  ${src}`);
    continue;
  }

  // Evitar duplicar kokoro_tts.py (ya está dentro de backend/src)
  if (src === 'backend/src/utils/kokoro_tts.py') continue;

  const stats   = copyRecursive(srcAbs, destAbs);
  totalFiles   += stats.files;
  totalSkipped += stats.skipped;
  manifest.push({ src, desc, files: stats.files });

  const label = stats.files === 1 ? '1 archivo ' : `${stats.files} archivos`;
  console.log(`  ✓  ${src.padEnd(44)} ${label.padStart(10)}   ${desc}`);
}

console.log(`\n  Total incluido : ${totalFiles} archivos`);
console.log(`  Total excluido : ${totalSkipped} archivos (node_modules, vídeos, modelos, logs...)\n`);

// 3. Crear el ZIP (PowerShell Compress-Archive — disponible en Windows 5.1+)
if (fs.existsSync(OUT_ZIP)) fs.unlinkSync(OUT_ZIP);

console.log('  Comprimiendo...');

const psCmd = `Compress-Archive -Path '${TMP_DIR.replace(/\\/g, '\\\\')}\\*' -DestinationPath '${OUT_ZIP.replace(/\\/g, '\\\\')}' -CompressionLevel Optimal`;
const result = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCmd], {
  encoding: 'utf8',
  windowsHide: true,
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
});

if (result.status !== 0) {
  console.error('\n  ERROR al comprimir:');
  console.error(result.stderr || result.stdout);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  process.exit(1);
}

// 4. Limpiar temporal
fs.rmSync(TMP_DIR, { recursive: true, force: true });

// 5. Resultado final
const zipSize = fmtSize(fs.statSync(OUT_ZIP).size);
console.log(`\n========================================`);
console.log(`  ZIP generado correctamente`);
console.log(`  ${zipSize.padEnd(10)}  releases/${ZIP_NAME}.zip`);
console.log(`========================================\n`);

// Salida JSON para el hook de Claude Code (Stop hook)
if (process.env.CLAUDE_HOOK) {
  process.stdout.write(JSON.stringify({
    systemMessage: `ZIP actualizado: ${totalFiles} archivos, ${zipSize} → releases/${ZIP_NAME}.zip`,
  }) + '\n');
}
