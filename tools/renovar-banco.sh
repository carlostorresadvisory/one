#!/usr/bin/env bash
# Renovación del banco con el criterio de utilidad (Carlos, 12-sep-2026):
# 1) generar ~25 preguntas nuevas por área con el criterio, 2) verificar solo lo nuevo,
# 3) validar, 4) puntuar utilidad solo de las nuevas (--reutilizar) y quitar las de
# utilidad 1 y los duplicados, 5) validar otra vez. Todo dentro del tope diario aprobado.
# Uso: bash tools/renovar-banco.sh [tope_eur_dia]   (por defecto 0.50)
set -u
cd "$(dirname "$0")/.."
TOPE="${1:-0.50}"
LOG="datos/renovacion.log"
PAGO="--permitir-pago --tope-eur $TOPE"

echo "=== renovar-banco $(date -Iseconds) tope=$TOPE ===" | tee -a "$LOG"
for area in economia historia ciencia tecnologia geografia filosofia arte logica; do
  echo "--- generar $area $(date +%H:%M) ---" | tee -a "$LOG"
  node tools/generar-preguntas.js --area "$area" $PAGO 2>&1 | tee -a "$LOG" | tail -3
done

echo "--- verificar pendientes $(date +%H:%M) ---" | tee -a "$LOG"
node tools/verificar-preguntas.js --solo-pendientes $PAGO 2>&1 | tee -a "$LOG" | tail -5

echo "--- validar $(date +%H:%M) ---" | tee -a "$LOG"
node tools/validar-banco.js 2>&1 | tee -a "$LOG" | tail -3

echo "--- filtrar utilidad (solo nuevas) y aplicar umbral 2 $(date +%H:%M) ---" | tee -a "$LOG"
node tools/filtrar-utilidad.js --reutilizar --umbral 2 --aplicar $PAGO 2>&1 | tee -a "$LOG" | tail -25

echo "--- validar final $(date +%H:%M) ---" | tee -a "$LOG"
node tools/validar-banco.js 2>&1 | tee -a "$LOG" | tail -3
echo "=== fin $(date -Iseconds) ===" | tee -a "$LOG"
