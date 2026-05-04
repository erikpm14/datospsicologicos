#!/bin/bash
# HOTFIX_RECOVERY.sh
# Activa el modo de recuperación para el sistema de generación

echo "╔════════════════════════════════════════════════════════╗"
echo "║  GENERADOR VIDEOS - HOTFIX RECOVERY MODE             ║"
echo "╚════════════════════════════════════════════════════════╝"
echo ""

# 1. Mostrar cambios realizados
echo "📋 CAMBIOS REALIZADOS:"
echo ""
echo "1️⃣  HOTFIX TTS (voice-synthesizer.js)"
echo "   ✓ TTS_TIMEOUT_MS: 120s → 60s (fallback más rápido si Kokoro falla)"
echo "   ✓ KOKORO_TIMEOUT_MS: nuevo, 45s (timeout individual)"
echo "   ✓ Edge TTS: retries 2 → 5 (con delay incremental)"
echo "   ✓ Edge TTS: validación de audio > 5KB + duración > 2s con ffprobe"
echo ""

echo "2️⃣  HOTFIX QC (production-quality-checker.js)"
echo "   ✓ RECOVERY_MODE: thresholds temporales lenientes"
echo "   ✓ virality: 70 → 40 en RECOVERY_MODE"
echo "   ✓ format: 70 → 60 en RECOVERY_MODE"
echo "   ✓ duration: [8s-45s] → [4s-55s] en RECOVERY_MODE"
echo "   ✓ hardFailChecks: removidos subtitle/hook/package checks en RECOVERY_MODE"
echo ""

echo "3️⃣  HOTFIX YOUTUBE (publisher.js)"
echo "   ✓ Mejorados logs de OAuth"
echo "   ✓ invalid_grant: logs claros con instrucciones de renovación"
echo ""

echo "4️⃣  HOTFIX SCHEDULER (scheduler.service.js)"
echo "   ✓ getNextPublishSlot(): calcula próximo slot"
echo "   ✓ Urgencia automática si faltan < 90min y ready < 3"
echo ""

echo "5️⃣  SCRIPTS NUEVOS"
echo "   ✓ backend/scripts/check-youtube-oauth.js"
echo "   ✓ backend/scripts/system-status.js"
echo ""

# 2. Activar RECOVERY_MODE
echo "═══════════════════════════════════════════════════════"
echo "🚀 ACTIVANDO RECOVERY_MODE..."
echo "═══════════════════════════════════════════════════════"
echo ""

export RECOVERY_MODE=true
export AUTO_GENERATION_ENABLED=true
export AUTO_PUBLISH_ENABLED=true

echo "✓ RECOVERY_MODE=true"
echo "✓ AUTO_GENERATION_ENABLED=true"
echo "✓ AUTO_PUBLISH_ENABLED=true"
echo ""

# 3. Status check
echo "═══════════════════════════════════════════════════════"
echo "📊 SISTEMA STATUS:"
echo "═══════════════════════════════════════════════════════"
node backend/scripts/system-status.js
echo ""

# 4. YouTube check
echo "═══════════════════════════════════════════════════════"
echo "🎥 YOUTUBE OAUTH CHECK:"
echo "═══════════════════════════════════════════════════════"
node backend/scripts/check-youtube-oauth.js
echo ""

# 5. Instrucciones finales
echo "═══════════════════════════════════════════════════════"
echo "⚡ PRÓXIMOS PASOS:"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "1. Inicia el servidor CON RECOVERY_MODE:"
echo "   $ RECOVERY_MODE=true npm start"
echo ""
echo "2. Monitorea logs en otra terminal:"
echo "   $ tail -f backend/logs/combined.log"
echo ""
echo "3. Cuando veas videos listos en 'done/':"
echo "   RECOVERY_MODE=false npm start  (vuelve a normal)"
echo ""
echo "4. Si YouTube sigue roto:"
echo "   Visita: http://localhost:3001/auth/youtube"
echo ""
