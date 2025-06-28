#!/bin/bash

# Script para iniciar Redis con configuración optimizada para Body Analysis

echo "🔄 Iniciando Redis con configuración optimizada..."

# Verificar si Redis está corriendo
if pgrep redis-server > /dev/null; then
    echo "⚠️ Redis ya está corriendo. Deteniéndolo..."
    redis-cli SHUTDOWN
    sleep 2
fi

# Iniciar Redis con la configuración personalizada
redis-server ./redis.conf

echo "✅ Redis iniciado con configuración optimizada"
echo "📊 Memoria máxima: 512MB"
echo "🔄 Política de expulsión: allkeys-lru" 