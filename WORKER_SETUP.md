# 🚀 Worker de Análisis Corporal - Configuración Completa

Sistema de colas para procesar análisis de imágenes corporales usando Ollama localmente sin exponer puertos.

## 📋 Requisitos Previos

### 1. Redis Instalado

```bash
# macOS
brew install redis
brew services start redis

# Ubuntu/Debian
sudo apt update
sudo apt install redis-server
sudo systemctl start redis-server

# Verificar que Redis funciona
redis-cli ping
# Debe responder: PONG
```

### 2. Ollama con LLaVA Instalado

```bash
# Instalar Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Descargar modelo LLaVA
ollama pull llava:7b-v1.6-mistral-q4_K_M

# Verificar que funciona
ollama list
```

### 3. Variables de Entorno

Asegúrate de que tu archivo `.env` tenga:

```bash
# Redis
REDIS_URL="redis://localhost:6379"

# OpenAI (para recomendaciones nutricionales)
OPENAI_API_KEY="sk-..."

# Base de datos
DATABASE_URL="mysql://usuario:password@localhost:3306/habit_tracker"

# JWT
JWT_SECRET="tu-jwt-secret-super-seguro"

# Puerto
PORT=3000
```

---

## 🔧 Configuración e Instalación

### 1. Instalar Dependencias (ya hecho)

```bash
npm install bullmq ioredis node-fetch dotenv
```

### 2. Verificar Tests

```bash
npm run test
# ✅ Todos los tests deben pasar
```

### 3. Compilar Proyecto

```bash
npm run build
```

---

## 🚀 Ejecutar el Worker

### Opción 1: Ejecutar en Desarrollo

```bash
# Terminal 1: Ejecutar el backend
npm run start:dev

# Terminal 2: Ejecutar el worker
npm run worker:dev
```

### Opción 2: Ejecutar con PM2 (Recomendado)

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Ejecutar backend
npm run start:dev

# Ejecutar worker con PM2
pm2 start npm --name "body-analysis-worker" -- run worker
pm2 logs body-analysis-worker
```

### Verificar que Todo Funcione

```bash
# Verificar logs del worker
npm run worker

# Deberías ver:
# 🚀 Iniciando worker de análisis corporal...
# ✅ Worker conectado a Redis
# 🔥 Worker de análisis corporal iniciado correctamente
# 📱 Esperando trabajos...
```

---

## 🧪 Probar el Sistema

### 1. Crear Análisis Corporal

```bash
curl -X POST http://localhost:3000/body-analysis \
  -H "Content-Type: application/json" \
  -d '{
    "image": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEA...",
    "currentWeight": 75,
    "targetWeight": 70,
    "height": 175,
    "age": 25,
    "gender": "male",
    "activityLevel": "active",
    "goals": ["lose_weight"]
  }'
```

### 2. Obtener Estado del Trabajo

```bash
# Respuesta del paso anterior:
# { "success": true, "data": { "taskId": "123", "status": "processing" } }

curl http://localhost:3000/tasks/123/status
```

### 3. Obtener Resultado Final

```bash
curl http://localhost:3000/tasks/123/result
```

---

## 📊 Monitoreo y Debugging

### Ver Logs del Worker

```bash
# Con npm
npm run worker

# Con PM2
pm2 logs body-analysis-worker

# Ver en tiempo real
pm2 logs body-analysis-worker --lines 50
```

### Monitorear Redis

```bash
# Conectarse a Redis CLI
redis-cli

# Ver trabajos pendientes
LLEN bull:bodyAnalysis:waiting

# Ver trabajos activos
LLEN bull:bodyAnalysis:active

# Ver trabajos completados
LLEN bull:bodyAnalysis:completed
```

### Verificar Estado de Ollama

```bash
# Ver modelos disponibles
ollama list

# Probar manualmente
ollama run llava:7b-v1.6-mistral-q4_K_M
```

---

## 🔧 Solución de Problemas

### Error: Redis Connection Failed

```bash
# Verificar que Redis esté ejecutándose
redis-cli ping

# Reiniciar Redis
brew services restart redis  # macOS
sudo systemctl restart redis # Linux
```

### Error: Ollama Not Found

```bash
# Verificar instalación
ollama --version

# Verificar que el servicio esté ejecutándose
ps aux | grep ollama

# Reiniciar servicio
ollama serve
```

### Error: Worker No Procesa Trabajos

```bash
# Verificar logs del worker
npm run worker

# Verificar que el modelo esté disponible
ollama list | grep llava

# Limpiar cola de Redis
redis-cli FLUSHDB
```

### Error: OpenAI API Key

```bash
# Verificar variable de entorno
echo $OPENAI_API_KEY

# O verificar archivo .env
cat .env | grep OPENAI
```

---

## 🔄 Flujo Completo

1. **Cliente** envía imagen → **Backend** crea trabajo en cola
2. **Worker** toma trabajo de la cola
3. **Worker** procesa imagen con **Ollama** local
4. **Worker** genera recomendaciones con **OpenAI**
5. **Worker** marca trabajo como completado
6. **Cliente** consulta resultado final

---

## ⚡ Ventajas de Esta Arquitectura

- ✅ **Seguridad**: Tu PC no expone puertos al internet
- ✅ **Escalabilidad**: Fácil agregar más workers
- ✅ **Robustez**: Fallos del worker no afectan el backend
- ✅ **Monitoreo**: Logs detallados de cada paso
- ✅ **Flexibilidad**: Fácil mover worker a otro servidor

---

## 🚀 Comandos Rápidos

```bash
# Iniciar todo el sistema
redis-server &
npm run start:dev &
npm run worker

# Con PM2
pm2 start ecosystem.config.js

# Ver estado
pm2 status
pm2 logs

# Parar todo
pm2 stop all
```

¡Listo! Tu worker de análisis corporal está configurado y funcionando. 🎉
