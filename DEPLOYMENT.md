# 🚀 Configuración de CI/CD - Despliegue Automático

Este proyecto utiliza GitHub Actions para despliegue automático a producción cada vez que se hace push a la rama `main`.

## 📋 Proceso de Despliegue

Cuando se hace push a `main`, el workflow automáticamente:

1. ✅ **Ejecuta tests** en el entorno de CI
2. 🏗️ **Construye el proyecto** para verificar que compila
3. 🔐 **Se conecta al servidor de producción** vía SSH
4. 📥 **Descarga los últimos cambios** (`git pull origin main`)
5. 📦 **Instala dependencias** (`npm ci`)
6. 🔧 **Genera cliente de Prisma** (`npx prisma generate`)
7. 🗃️ **Ejecuta migraciones de BD** (`npx prisma db push`)
8. 🏗️ **Construye la aplicación** (`npm run build`)
9. 🔄 **Reinicia con PM2** (`pm2 restart 3`)
10. ✅ **Verifica el estado** de la aplicación

## 🔐 Configuración de Secrets

Debes configurar estos secrets en tu repositorio de GitHub:

### Configurar Secrets en GitHub:

1. Ve a tu repositorio en GitHub
2. Navega a **Settings** → **Secrets and variables** → **Actions**
3. Clic en **New repository secret**
4. Agrega cada uno de los siguientes secrets:

### Secrets Requeridos:

| Secret              | Descripción                   | Ejemplo                             |
| ------------------- | ----------------------------- | ----------------------------------- |
| `PROD_HOST`         | IP o dominio del servidor     | `192.168.1.100` o `mi-servidor.com` |
| `PROD_USERNAME`     | Usuario SSH del servidor      | `ubuntu`, `root`, `deploy`          |
| `PROD_SSH_KEY`      | Clave privada SSH (completa)  | Ver instrucciones abajo             |
| `PROD_PORT`         | Puerto SSH (opcional)         | `22` (default), `2222`              |
| `PROD_PROJECT_PATH` | Ruta del proyecto en servidor | `/var/www/habit-tracker-backend`    |
| `PM2_APP_ID`        | ID de PM2 (opcional)          | `3` (default), `backend`, `0`       |

## 🔑 Configuración de SSH

### 1. Generar Clave SSH (si no tienes una):

```bash
# En tu máquina local
ssh-keygen -t rsa -b 4096 -C "deploy@habit-tracker"
# Guardará en ~/.ssh/id_rsa (privada) y ~/.ssh/id_rsa.pub (pública)
```

### 2. Configurar en el Servidor:

```bash
# En el servidor de producción
mkdir -p ~/.ssh
nano ~/.ssh/authorized_keys
# Pega el contenido de tu clave PÚBLICA (id_rsa.pub)
chmod 700 ~/.ssh
chmod 600 ~/.ssh/authorized_keys
```

### 3. Configurar Secret en GitHub:

```bash
# Copia el contenido COMPLETO de tu clave PRIVADA
cat ~/.ssh/id_rsa
```

- Copia TODO el contenido (incluye `-----BEGIN` y `-----END`)
- Pégalo en el secret `PROD_SSH_KEY`

## 🛠️ Configuración del Servidor

### Estructura Recomendada:

```
/var/www/habit-tracker-backend/
├── .git/
├── src/
├── package.json
├── prisma/
└── dist/
```

### Comandos Iniciales en el Servidor:

```bash
# Instalar Node.js, npm, PM2
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2

# Clonar el repositorio
sudo mkdir -p /var/www
cd /var/www
sudo git clone https://github.com/TU_USUARIO/TU_REPO.git habit-tracker-backend
sudo chown -R $USER:$USER habit-tracker-backend
cd habit-tracker-backend

# Primera configuración
npm install
npx prisma generate
npm run build

# Configurar PM2 (ajusta el comando según tu configuración)
pm2 start dist/main.js --name "habit-tracker-backend" -i 1
pm2 save
pm2 startup
```

## 🔍 Variables de Entorno

Asegúrate de tener un archivo `.env` en el servidor con:

```env
# Base de datos
DATABASE_URL="mysql://usuario:password@localhost:3306/habit_tracker"

# OpenAI
OPENAI_API_KEY="tu-api-key-openai"

# JWT
JWT_SECRET="tu-jwt-secret-super-seguro"

# Puerto
PORT=3000
```

## 🧪 Testing del Workflow

### Probar SSH Manualmente:

```bash
# Desde tu máquina local
ssh -i ~/.ssh/id_rsa usuario@servidor
```

### Ver Logs del Workflow:

1. Ve a tu repositorio en GitHub
2. Navega a **Actions**
3. Selecciona el workflow más reciente
4. Revisa los logs de cada paso

## 🚨 Solución de Problemas

### Error de SSH:

```bash
# Verificar conexión
ssh -v usuario@servidor

# Verificar permisos
ls -la ~/.ssh/
```

### Error de PM2:

```bash
# Ver aplicaciones
pm2 list

# Ver logs
pm2 logs

# Verificar ID correcto
pm2 show 3  # O el ID que uses
```

### Error de Dependencias:

```bash
# Limpiar node_modules
rm -rf node_modules package-lock.json
npm install
```

## 📊 Monitoreo

### Comandos Útiles en Producción:

```bash
# Estado de PM2
pm2 status

# Logs en tiempo real
pm2 logs --lines 50

# Reinicio manual
pm2 restart 3

# Recursos del sistema
htop
df -h
```

---

## ⚡ Quick Start

1. **Configura los secrets** en GitHub (ver tabla arriba)
2. **Configura SSH** en el servidor
3. **Haz push a main**
4. **¡Listo!** 🎉

El despliegue debería ejecutarse automáticamente y tu aplicación estar disponible en pocos minutos.
