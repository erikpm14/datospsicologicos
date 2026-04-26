#!/bin/bash
# deploy.sh — Deployment a Railway (backend) + Vercel (frontend)
# Uso: bash scripts/deploy.sh

set -e

echo "╔══════════════════════════════════════╗"
echo "║  Psychology Shorts — Deploy Script   ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── BACKEND → Railway ───────────────────────────────────────────────────────

echo "🚂 Desplegando backend en Railway..."

if ! command -v railway &>/dev/null; then
  echo "   Instalando Railway CLI..."
  npm install -g @railway/cli
fi

cd backend

# Variables de entorno (se leen desde .env local o se setean manualmente en Railway dashboard)
echo "   Subiendo backend..."
railway up --detach

echo "   ✓ Backend desplegado"
echo ""

# ─── WORKER (separado) ───────────────────────────────────────────────────────

echo "   Configurando worker service en Railway..."
echo "   (Crea un segundo servicio en Railway con: npm run worker)"
echo ""

cd ..

# ─── FRONTEND → Vercel ───────────────────────────────────────────────────────

echo "▲  Desplegando frontend en Vercel..."

if ! command -v vercel &>/dev/null; then
  echo "   Instalando Vercel CLI..."
  npm install -g vercel
fi

cd frontend

echo "   Compilando..."
npm run build

echo "   Subiendo a Vercel..."
vercel --prod --yes

echo "   ✓ Frontend desplegado"

cd ..

echo ""
echo "╔══════════════════════════════════════╗"
echo "║  Deploy completado ✅                ║"
echo "╠══════════════════════════════════════╣"
echo "║  Backend:  Railway dashboard         ║"
echo "║  Frontend: Vercel dashboard          ║"
echo "╚══════════════════════════════════════╝"
