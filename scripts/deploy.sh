#!/bin/bash

# 🚀 Script de Despliegue Manual
# Ejecuta: chmod +x scripts/deploy.sh && ./scripts/deploy.sh

set -e  # Salir si hay algún error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para logs con colores
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Variables (puedes configurar estas)
SERVER_HOST="${PROD_HOST:-tu-servidor.com}"
SERVER_USER="${PROD_USERNAME:-ubuntu}"
SERVER_PATH="${PROD_PROJECT_PATH:-/var/www/habit-tracker-backend}"
PM2_APP_ID="${PM2_APP_ID:-3}"
SSH_KEY_PATH="${SSH_KEY_PATH:-~/.ssh/id_rsa}"

echo "🚀 Iniciando despliegue manual a producción..."
echo "======================================================"
echo "Servidor: $SERVER_USER@$SERVER_HOST"
echo "Ruta: $SERVER_PATH"
echo "PM2 App ID: $PM2_APP_ID"
echo "======================================================"

# Verificar que tenemos conexión SSH
log_info "Verificando conexión SSH..."
if ! ssh -i "$SSH_KEY_PATH" -o ConnectTimeout=10 "$SERVER_USER@$SERVER_HOST" "echo 'Conexión SSH exitosa'" 2>/dev/null; then
    log_error "No se pudo conectar al servidor via SSH"
    log_info "Verifica:"
    log_info "- Que la IP/dominio sea correcto: $SERVER_HOST"
    log_info "- Que el usuario sea correcto: $SERVER_USER"
    log_info "- Que tengas la clave SSH: $SSH_KEY_PATH"
    exit 1
fi

log_success "Conexión SSH verificada"

# Ejecutar despliegue en el servidor
log_info "Ejecutando despliegue en el servidor..."

ssh -i "$SSH_KEY_PATH" "$SERVER_USER@$SERVER_HOST" << EOF
    set -e
    
    echo "🚀 Iniciando despliegue en producción..."
    
    # Navegar al directorio del proyecto
    cd $SERVER_PATH
    echo "📂 Directorio actual: \$(pwd)"
    
    echo "📥 Descargando últimos cambios..."
    git pull origin main
    
    echo "📦 Instalando dependencias..."
    npm ci --production=false
    
    echo "🔧 Generando cliente de Prisma..."
    npx prisma generate
    
    echo "🗃️ Ejecutando migraciones de base de datos..."
    npx prisma db push
    
    echo "🏗️ Construyendo proyecto..."
    npm run build
    
    echo "🔄 Reiniciando aplicación con PM2..."
    pm2 restart $PM2_APP_ID
    
    echo "✅ Despliegue completado exitosamente!"
    
    # Verificar el estado de la aplicación
    echo "📊 Estado de la aplicación:"
    pm2 show $PM2_APP_ID
    
    echo "🎉 Aplicación desplegada y funcionando correctamente!"
EOF

log_success "¡Despliegue completado exitosamente!"
log_info "Puedes verificar el estado de la aplicación ejecutando:"
log_info "ssh -i $SSH_KEY_PATH $SERVER_USER@$SERVER_HOST 'pm2 logs $PM2_APP_ID --lines 50'"

echo ""
echo "🎉 ¡Todo listo! Tu aplicación debería estar funcionando en producción." 