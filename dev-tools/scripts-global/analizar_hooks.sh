#!/bin/bash

# Analizar hooks de los últimos 10 videos generados

echo "═══════════════════════════════════════════════════════════════"
echo "ANÁLISIS DE HOOKS CON VARIEDAD CONTROLADA"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# Obtener las 10 carpetas más recientes
dirs=$(ls -td /c/Users/Erik/Desktop/Generador_videos/output/*/ | head -10 | xargs -I {} basename {})

hooks=()
topics=()
emotionals=()
viralities=()

for id in $dirs; do
  dir="/c/Users/Erik/Desktop/Generador_videos/output/$id"

  if [ -f "$dir/script.json" ]; then
    # Extraer datos manualmente sin jq
    hook=$(grep -o '"hook": "[^"]*"' "$dir/script.json" | cut -d'"' -f4)
    topic=$(grep -o '"topic": "[^"]*"' "$dir/script.json" | head -1 | cut -d'"' -f4)
    emotional=$(grep -o '"emotionalTrigger": "[^"]*"' "$dir/script.json" | cut -d'"' -f4)
    virality=$(grep -o '"viralityScore": [0-9.]*' "$dir/script.json" | grep -o '[0-9.]*')

    hooks+=("$hook")
    topics+=("$topic")
    emotionals+=("$emotional")
    viralities+=("$virality")

    echo "ID: ${id:0:8}..."
    echo "  Hook: $hook"
    echo "  Topic: $topic | Emotional: $emotional | Virality: $virality"
    echo ""
  fi
done

echo "═══════════════════════════════════════════════════════════════"
echo "VALIDACIÓN DE VARIEDAD"
echo "═══════════════════════════════════════════════════════════════"

# Chequear si hay hooks duplicados
echo "Verificando duplicados:"
for i in "${!hooks[@]}"; do
  for j in "${!hooks[@]}"; do
    if [ $i -lt $j ] && [ "${hooks[$i]}" = "${hooks[$j]}" ]; then
      echo "  ⚠️  Duplicado encontrado en posiciones $i y $j: ${hooks[$i]}"
    fi
  done
done

echo ""
echo "✅ Hooks únicos generados: ${#hooks[@]}/10"
echo ""

# Chequear cumplimiento de criterios
echo "═══════════════════════════════════════════════════════════════"
echo "CUMPLIMIENTO DE CRITERIOS"
echo "═══════════════════════════════════════════════════════════════"

validation_count=0
virality_count=0
topic_count=0

for i in "${!emotionals[@]}"; do
  [ "${emotionals[$i]}" = "validation" ] && ((validation_count++))
  [ "${viralities[$i]}" != "" ] && val="${viralities[$i]}" && (( $(echo "$val > 70" | bc -l) )) && ((virality_count++))
  [ "${topics[$i]}" = "relationships" ] || [ "${topics[$i]}" = "habits" ] && ((topic_count++))
done

echo "✅ Emotional trigger = validation: $validation_count/10"
echo "✅ Virality > 70: $virality_count/10"
echo "✅ Topic en whitelist: $topic_count/10"
echo ""
