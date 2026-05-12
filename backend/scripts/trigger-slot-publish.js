#!/usr/bin/env node
/**
 * Dispara la lógica de publicación del slot 14:30
 */
const path = require('path');
const { publishWithRetries } = require('./src/services/anti-failure-publish-wrapper');
const { validateReadyVideo } = require('./src/services/ready-video-validator.service');
const { recordPublication } = require('../content-engine/tracking/publication-attribution');

const PRINCIPAL_ID = '9e3208ce-04d9-47b1-9b7a-d3c2b7025867';
const BACKUP_ID = '2b260bb2-0a8c-4ac6-ad54-14ba64ceae4e';
const OUTPUT_DIR = './output-fase1-test';

async function triggerSlotPublish() {
  console.log('[SLOT_PUBLISH_TRIGGER] Iniciando publicación manual del slot 14:30');
  
  // Validar principal
  console.log('[SLOT_PUBLISH_TRIGGER] Validando Principal...');
  const principalVal = validateReadyVideo(PRINCIPAL_ID);
  
  if (!principalVal.ready) {
    console.error('[SLOT_PUBLISH_TRIGGER] Principal FALLÓ validación:', principalVal.errors);
    console.log('[SLOT_PUBLISH_TRIGGER] Intentando Backup...');
    
    // Validar backup
    const backupVal = validateReadyVideo(BACKUP_ID);
    if (!backupVal.ready) {
      console.error('[SLOT_PUBLISH_TRIGGER] Backup FALLÓ validación:', backupVal.errors);
      console.error('[SLOT_PUBLISH_TRIGGER] FALLO: Ningún candidato válido');
      process.exit(1);
    }
    
    console.log('[SLOT_PUBLISH_TRIGGER] Publicando BACKUP...');
    const videoPath = path.join(OUTPUT_DIR, BACKUP_ID, 'output.mp4');
    const scriptPath = path.join(OUTPUT_DIR, BACKUP_ID, 'script.json');
    
    const { publishAll } = require('./src/services/publisher');
    const script = require('fs').existsSync(scriptPath) ? JSON.parse(require('fs').readFileSync(scriptPath, 'utf8')) : {};
    
    const result = await publishAll(videoPath, script, null, { source: 'publish-scheduler', videoId: BACKUP_ID });
    console.log('[SLOT_PUBLISH_TRIGGER] Resultado Backup:', result);
    
  } else {
    console.log('[SLOT_PUBLISH_TRIGGER] Publicando PRINCIPAL...');
    const videoPath = path.join(OUTPUT_DIR, PRINCIPAL_ID, 'output.mp4');
    const scriptPath = path.join(OUTPUT_DIR, PRINCIPAL_ID, 'script.json');
    
    const { publishAll } = require('./src/services/publisher');
    const script = require('fs').existsSync(scriptPath) ? JSON.parse(require('fs').readFileSync(scriptPath, 'utf8')) : {};
    
    const result = await publishAll(videoPath, script, null, { source: 'publish-scheduler', videoId: PRINCIPAL_ID });
    console.log('[SLOT_PUBLISH_TRIGGER] Resultado Principal:', result);
  }
}

triggerSlotPublish().catch(err => {
  console.error('[SLOT_PUBLISH_TRIGGER] Error:', err.message);
  process.exit(1);
});
