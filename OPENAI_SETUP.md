# 🤖 Configuración de OpenAI para Recomendaciones de Contenido

## Descripción

El backend ahora incluye un sistema avanzado de recomendaciones de contenido powered by OpenAI que puede generar sugerencias personalizadas de:

- 📚 **Libros**
- 📄 **Artículos**
- 🎧 **Podcasts**
- 📝 **Blogs**
- 🔬 **Estudios científicos**
- 📊 **Informes técnicos**

## Configuración Requerida

### 1. Obtener API Key de OpenAI

1. Ve a [OpenAI Platform](https://platform.openai.com/)
2. Crea una cuenta o inicia sesión
3. Ve a API Keys en tu dashboard
4. Crea una nueva API key
5. Copia la key (empieza con `sk-...`)

### 2. Configurar Variables de Entorno

Crea un archivo `.env` en el directorio `backend/` con:

```env
# OpenAI Configuration
OPENAI_API_KEY=sk-your-actual-api-key-here

# Otras variables necesarias...
DATABASE_URL="postgresql://username:password@localhost:5432/habit_tracker"
JWT_SECRET=your_jwt_secret_here
JWT_EXPIRES_IN=7d
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:3000
```

### 3. Instalar Dependencias

```bash
npm install openai
```

## Endpoints Disponibles

### POST /analysis/content-recommendations

Genera recomendaciones personalizadas de contenido con OpenAI.

**Request Body:**

```json
{
  "availableTime": "30 min",
  "preferredMood": "⚡ Motivacional",
  "contentType": "Cualquiera",
  "topic": "machine learning",
  "genre": "🤖 Inteligencia Artificial",
  "includeUserPatterns": true
}
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "title": "Deep Learning Fundamentals",
      "author": "Dr. Andrew Ng",
      "description": "Introducción completa al deep learning...",
      "reason": "Perfecto para tu interés en machine learning",
      "category": "Inteligencia Artificial",
      "estimatedTime": "25 min",
      "difficulty": "Intermedio",
      "type": "artículo",
      "link": "https://example.com/article",
      "source": "MIT Technology Review",
      "tags": ["AI", "Deep Learning", "Neural Networks"]
    }
  ]
}
```

### GET /analysis/status

Verifica el estado del servicio y disponibilidad de OpenAI.

## Características del Sistema

### 🎯 Filtros Inteligentes

- **Tiempo disponible**: 5 min, 15 min, 30 min, 1 hora, 2+ horas
- **Estado de ánimo**: Motivacional, Relajante, Educativo, Inspirador, Técnico
- **Tipo de contenido**: Libros, Artículos, Podcasts, Blogs, Estudios, Informes
- **Género/Tema**: 11 categorías especializadas
- **Búsqueda específica**: Términos libres

### 🧠 IA Contextual

- Analiza patrones del usuario
- Adapta recomendaciones al tiempo disponible
- Considera estado de ánimo y preferencias
- Genera contenido real y verificable
- Incluye links y fuentes cuando es posible

### 🛡️ Fallback System

Si OpenAI no está disponible, el sistema automáticamente usa recomendaciones curadas de alta calidad.

## Uso en el Frontend

El frontend (`ReadingAssistant.tsx`) ya está configurado para usar estos endpoints:

```typescript
const response = await api.analysis.getContentRecommendations({
  availableTime,
  preferredMood,
  contentType,
  topic,
  genre,
  includeUserPatterns: true,
});
```

## Costos de OpenAI

- **Modelo usado**: gpt-4o
- **Tokens por request**: ~1500-2500
- **Costo estimado**: $0.002-0.004 por recomendación
- **Optimización**: Sistema de fallback reduce llamadas innecesarias

## Troubleshooting

### Error: "OpenAI no disponible"

- Verifica que `OPENAI_API_KEY` esté configurada
- Confirma que la API key sea válida
- Revisa los logs del servidor

### Error: "Respuesta de OpenAI no válida"

- OpenAI puede devolver texto no-JSON ocasionalmente
- El sistema automáticamente usa fallback
- Los errores se loggean para debugging

### Sin recomendaciones

- Verifica filtros (muy restrictivos pueden dar 0 resultados)
- El sistema siempre devuelve al menos 1 recomendación de fallback
