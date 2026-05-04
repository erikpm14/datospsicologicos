#!/usr/bin/env node
/**
 * system-status.js
 * Reporte operativo del sistema de generación de vídeos.
 * Ejecutar: node backend/scripts/system-status.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m',
};

async function printStatus() {
  console.log(`\n${colors.blue}${colors.bold}=== SISTEMA DE GENERACIÓN DE VÍDEOS ===${colors.reset}\n`);

  // 1. YouTube OAuth
  console.log(`${colors.bold}YouTube OAuth:${colors.reset}`);
  const hasYTToken = Boolean(process.env.YOUTUBE_REFRESH_TOKEN && process.env.YOUTUBE_REFRESH_TOKEN !== 'RELLENAR');
  if (!hasYTToken) {
    console.log(`  ${colors.red}❌ Token no configurado${colors.reset}`);
    console.log(`  ${colors.yellow}ACCIÓN: http://localhost:3001/auth/youtube${colors.reset}`);
  } else {
    try {
      await axios.post('https://oauth2.googleapis.com/token', {
        client_id: process.env.YOUTUBE_CLIENT_ID,
        client_secret: process.env.YOUTUBE_CLIENT_SECRET,
        refresh_token: process.env.YOUTUBE_REFRESH_TOKEN,
        grant_type: 'refresh_token',
      }, { timeout: 5000 });
      console.log(`  ${colors.green}✓ Token válido${colors.reset}`);
    } catch (err) {
      const code = err.response?.data?.error || 'UNKNOWN';
      console.log(`  ${colors.red}❌ Token inválido: ${code}${colors.reset}`);
      if (code === 'invalid_grant') {
        console.log(`  ${colors.yellow}ACCIÓN: http://localhost:3001/auth/youtube${colors.reset}`);
      }
    }
  }

  // 2. Queue Status
  console.log(`\n${colors.bold}Queue Status:${colors.reset}`);
  try {
    const queuePath = path.resolve('./backend/queue');
    const pending = fs.readdirSync(path.join(queuePath, 'pending')).filter(f => f.endsWith('.json')).length;
    const active = fs.readdirSync(path.join(queuePath, 'active')).filter(f => f.endsWith('.json')).length;
    const done = fs.readdirSync(path.join(queuePath, 'done')).filter(f => f.endsWith('.json')).length;
    const failed = fs.readdirSync(path.join(queuePath, 'failed')).filter(f => f.endsWith('.json')).length;

    console.log(`  Pending: ${pending} | Active: ${active} | Done: ${done} | Failed: ${failed}`);
    
    const totalSuccess = done;
    const totalFail = failed;
    const successRate = totalSuccess + totalFail > 0 
      ? Math.round((totalSuccess / (totalSuccess + totalFail)) * 100)
      : 0;
    
    console.log(`  Success rate: ${successRate}% (${totalSuccess} done, ${totalFail} failed)`);
    
    if (pending === 0 && active === 0) {
      console.log(`  ${colors.red}⚠️  Sin jobs en pipeline${colors.reset}`);
    }
    if (done === 0) {
      console.log(`  ${colors.red}⚠️  Sin videos completados correctamente${colors.reset}`);
    }
  } catch (err) {
    console.log(`  ${colors.red}Error: ${err.message}${colors.reset}`);
  }

  // 3. Recovery Mode
  console.log(`\n${colors.bold}QC Mode:${colors.reset}`);
  const recoveryMode = process.env.RECOVERY_MODE === 'true';
  if (recoveryMode) {
    console.log(`  ${colors.yellow}⚠️  RECOVERY_MODE ENABLED (thresholds bajos)${colors.reset}`);
  } else {
    console.log(`  ${colors.green}✓ Normal mode${colors.reset}`);
  }

  // 4. Next Slot
  console.log(`\n${colors.bold}Next Publish Slot:${colors.reset}`);
  try {
    const slotTimesStr = process.env.PUBLISH_TIMES_CET || '09:00,13:00,15:30,19:00,21:00';
    const slots = slotTimesStr.split(',').map(s => {
      const [h, m] = s.trim().split(':').map(Number);
      return h * 60 + m;
    }).sort((a, b) => a - b);

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    
    let nextSlot = null;
    for (const slot of slots) {
      if (slot > currentMinutes) {
        nextSlot = slot;
        break;
      }
    }

    if (nextSlot === null) {
      nextSlot = slots[0];
      const h = Math.floor(nextSlot / 60);
      const m = nextSlot % 60;
      console.log(`  ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (mañana)`);
    } else {
      const h = Math.floor(nextSlot / 60);
      const m = nextSlot % 60;
      const minutesUntil = nextSlot - currentMinutes;
      console.log(`  ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} (en ${minutesUntil} min)`);
      
      if (minutesUntil < 90) {
        console.log(`  ${colors.yellow}⚠️  PRÓXIMO SLOT EN < 90 MINUTOS${colors.reset}`);
      }
    }
  } catch (err) {
    console.log(`  Error: ${err.message}`);
  }

  // 5. Summary
  console.log(`\n${colors.bold}RESUMEN:${colors.reset}`);
  console.log(`  ${colors.yellow}Para recuperación inmediata:${colors.reset}`);
  console.log(`  1. Ejecuta: RECOVERY_MODE=true npm start`);
  console.log(`  2. O si YouTube está roto: http://localhost:3001/auth/youtube`);
  console.log(`  3. Monitorea: tail -f backend/logs/combined.log`);

  console.log(`\n${colors.blue}=== FIN ===${colors.reset}\n`);
}

printStatus().catch(err => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
