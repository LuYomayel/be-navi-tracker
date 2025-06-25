# 🔐 Autenticación JWT - Backend NestJS

## ✅ Sistema Completamente Implementado

El backend ahora cuenta con un sistema de autenticación JWT profesional y seguro.

---

## 🏗️ Arquitectura Implementada

### Componentes Principales

1. **JWT Strategy** - Validación de tokens
2. **JWT Guard** - Protección de rutas
3. **Decoradores** - `@Public()`, `@CurrentUser()`
4. **DTOs** - Validación de datos de entrada
5. **Bcrypt** - Hash seguro de contraseñas
6. **Prisma** - ORM para base de datos

---

## 🔑 Endpoints Disponibles

### **Rutas Públicas** (No requieren autenticación)

#### `POST /api/auth/register`

```json
{
  "email": "usuario@ejemplo.com",
  "password": "123456",
  "name": "Nombre Usuario"
}
```

**Respuesta:**

```json
{
  "success": true,
  "data": {
    "message": "Usuario registrado exitosamente",
    "user": {
      "id": "cuid",
      "email": "usuario@ejemplo.com",
      "name": "Nombre Usuario",
      "plan": "free",
      "isActive": true,
      "createdAt": "2025-06-25T21:09:24.599Z"
    },
    "tokens": {
      "accessToken": "eyJhbGciOiJIUzI1NiIs...",
      "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
    },
    "expiresAt": "2025-06-25T21:24:24.606Z"
  }
}
```

#### `POST /api/auth/login`

```json
{
  "email": "usuario@ejemplo.com",
  "password": "123456"
}
```

**Respuesta:** Igual que register

#### `POST /api/auth/refresh`

```json
{
  "refreshToken": "eyJhbGciOiJIUzI1NiIs..."
}
```

---

### **Rutas Protegidas** (Requieren Bearer Token)

#### `GET /api/auth/profile`

**Headers:** `Authorization: Bearer <access_token>`

**Respuesta:**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "cuid",
      "email": "usuario@ejemplo.com",
      "name": "Nombre Usuario",
      "plan": "free",
      "isActive": true,
      "createdAt": "2025-06-25T21:09:24.599Z",
      "updatedAt": "2025-06-25T21:09:24.599Z"
    }
  }
}
```

#### `GET /api/auth/verify`

**Headers:** `Authorization: Bearer <access_token>`

**Respuesta:**

```json
{
  "success": true,
  "data": {
    "message": "Token válido",
    "user": {
      "sub": "cuid",
      "email": "usuario@ejemplo.com",
      "name": "Nombre Usuario",
      "plan": "free"
    }
  }
}
```

#### `POST /api/auth/logout`

**Headers:** `Authorization: Bearer <access_token>`

---

## 🛡️ Seguridad Implementada

### **Protección de Rutas**

- **Guard Global**: Todas las rutas requieren autenticación por defecto
- **Decorador @Public()**: Para rutas públicas específicas
- **Validación JWT**: Tokens firmados y verificados
- **Expiración**: Access tokens 15min, Refresh tokens 7 días

### **Hash de Contraseñas**

- **Bcrypt** con 12 salt rounds
- **Validación segura** de contraseñas

### **Validación de Datos**

- **DTOs con class-validator**
- **Pipes de validación global**
- **Mensajes de error en español**

---

## 🔧 Configuración Técnica

### **Variables de Entorno**

```bash
# JWT Secrets (cambiar en producción)
JWT_SECRET="super-secret-jwt-key-change-in-production"
JWT_REFRESH_SECRET="super-secret-refresh-key-change-in-production"

# Base de datos
DATABASE_URL="mysql://user:pass@localhost:3306/db"

# CORS
CORS_ORIGIN="http://localhost:3000"

# Server
PORT=4000
NODE_ENV=development
```

### **Configuración JWT**

- **Algoritmo**: HS256
- **Issuer**: habit-tracker-api
- **Audience**: habit-tracker-app
- **Access Token**: 15 minutos
- **Refresh Token**: 7 días

---

## 🗄️ Base de Datos

### **Modelo User**

```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  name      String
  password  String
  plan      String   @default("free") // free, basic, premium
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("users")
}
```

---

## 🧪 Pruebas Realizadas ✅

### **Registro de Usuario**

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@ejemplo.com", "password": "123456", "name": "Usuario Test"}'
```

✅ **Resultado**: Usuario creado, tokens generados

### **Login de Usuario**

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@ejemplo.com", "password": "123456"}'
```

✅ **Resultado**: Login exitoso, nuevos tokens generados

### **Acceso a Perfil**

```bash
curl -X GET http://localhost:4000/api/auth/profile \
  -H "Authorization: Bearer <token>"
```

✅ **Resultado**: Perfil de usuario obtenido

### **Acceso Sin Token**

```bash
curl -X GET http://localhost:4000/api/auth/profile
```

✅ **Resultado**: Error 401 - Acceso no autorizado

### **Rutas Protegidas**

```bash
curl -X GET http://localhost:4000/api/activities
```

✅ **Resultado**: Error 401 - Todas las rutas están protegidas

---

## 🚀 Estados de Funcionamiento

| Endpoint                  | Estado | Descripción                |
| ------------------------- | ------ | -------------------------- |
| `POST /api/auth/register` | ✅     | Registro completo con JWT  |
| `POST /api/auth/login`    | ✅     | Login con JWT y bcrypt     |
| `POST /api/auth/refresh`  | ✅     | Renovación de tokens       |
| `GET /api/auth/profile`   | ✅     | Perfil protegido           |
| `GET /api/auth/verify`    | ✅     | Verificación de token      |
| `POST /api/auth/logout`   | ✅     | Logout básico              |
| **Guards Globales**       | ✅     | Todas las rutas protegidas |
| **Validación de Datos**   | ✅     | DTOs funcionando           |
| **Hash de Contraseñas**   | ✅     | Bcrypt implementado        |
| **Base de Datos**         | ✅     | Usuario tabla creada       |

---

## 🎯 Próximos Pasos Sugeridos

1. **Blacklist de Tokens** - Redis para invalidar tokens
2. **Rate Limiting** - Protección contra ataques
3. **Roles y Permisos** - Sistema RBAC
4. **2FA** - Autenticación de dos factores
5. **OAuth** - Login con Google/Facebook
6. **Logging** - Registro de eventos de seguridad

---

## 🔍 Migración del Frontend

El frontend debe actualizar:

```typescript
// Cambiar puerto del backend
const BACKEND_URL = 'http://localhost:4000';

// Headers con JWT
const headers = {
  Authorization: `Bearer ${accessToken}`,
  'Content-Type': 'application/json',
};
```

---

**🎉 ¡Sistema JWT Completamente Funcional y Profesional!**
