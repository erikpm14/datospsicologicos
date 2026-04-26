#!/usr/bin/env python3
"""
google-trends.py
Obtiene tendencias de psicología desde Google Trends usando pytrends (GRATUITO).

Uso:
  python scripts/google-trends.py

Salida:
  JSON a stdout con trending keywords y señal de viralidad.
  Si pytrends no está instalado o falla, devuelve {} vacío (graceful fallback).

Instalación de pytrends:
  pip install pytrends
"""

import json
import sys
import time

PSYCHOLOGY_KEYWORDS = [
    "cerebro", "dopamina", "ansiedad", "procrastinacion",
    "habitos", "psicologia", "sesgos cognitivos", "motivacion",
    "memoria", "emociones", "autoestima", "relaciones toxicas",
]

TIMEFRAME = "now 7-d"   # últimos 7 días
GEO       = "ES"        # España (mayor audiencia objetivo)
LANG      = "es"

def get_trending_keywords():
    try:
        from pytrends.request import TrendReq
    except ImportError:
        print(json.dumps({"error": "pytrends_not_installed", "trending": []}), flush=True)
        sys.exit(0)

    results = []

    try:
        pytrends = TrendReq(hl=LANG, tz=60, timeout=(10, 25), retries=2, backoff_factor=0.5)

        # Dividir keywords en grupos de 5 (límite de pytrends por llamada)
        groups = [PSYCHOLOGY_KEYWORDS[i:i+5] for i in range(0, len(PSYCHOLOGY_KEYWORDS), 5)]

        for group in groups:
            try:
                pytrends.build_payload(group, timeframe=TIMEFRAME, geo=GEO)
                interest = pytrends.interest_over_time()

                if interest.empty:
                    continue

                # Valor promedio de la última semana para cada keyword
                for kw in group:
                    if kw in interest.columns:
                        avg_val = float(interest[kw].mean())
                        if avg_val > 10:  # filtrar señales muy débiles
                            results.append({
                                "keyword": kw,
                                "signal":  round(avg_val, 1),
                            })

                time.sleep(1.2)  # evitar rate limiting

            except Exception as group_err:
                # Continuar con el siguiente grupo si uno falla
                sys.stderr.write(f"Group error ({group}): {group_err}\n")
                time.sleep(2)
                continue

        # Ordenar por señal descendente
        results.sort(key=lambda x: x["signal"], reverse=True)

        # Mapear keywords a topics internos
        KEYWORD_TOPIC_MAP = {
            "cerebro":           "cognitive_biases",
            "dopamina":          "dopamine",
            "ansiedad":          "emotional_patterns",
            "procrastinacion":   "procrastination",
            "habitos":           "habits",
            "psicologia":        "cognitive_biases",
            "sesgos cognitivos": "cognitive_biases",
            "motivacion":        "motivation",
            "memoria":           "memory",
            "emociones":         "emotions",
            "autoestima":        "self_talk",
            "relaciones toxicas":"relationships",
        }

        trending = []
        seen_topics = set()

        for item in results[:10]:
            topic = KEYWORD_TOPIC_MAP.get(item["keyword"], "cognitive_biases")
            if topic not in seen_topics:
                seen_topics.add(topic)
                trending.append({
                    "keyword": item["keyword"],
                    "topic":   topic,
                    "signal":  item["signal"],
                })

        output = {
            "source":    "google_trends",
            "geo":       GEO,
            "timeframe": TIMEFRAME,
            "trending":  trending,
            "raw_count": len(results),
        }

        print(json.dumps(output, ensure_ascii=False), flush=True)

    except Exception as e:
        sys.stderr.write(f"pytrends error: {e}\n")
        print(json.dumps({"error": str(e), "trending": []}), flush=True)
        sys.exit(0)


if __name__ == "__main__":
    get_trending_keywords()
