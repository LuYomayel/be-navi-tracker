import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import fetch from 'node-fetch';
import * as dotenv from 'dotenv';
import {
  generateBodyAnalysisPrompt,
  generateNutritionRecommendation,
  validateAndCleanBodyAnalysis,
  cleanJson,
  isJson,
  BodyAnalysisApiResponse,
} from '../src/worker/body-analysis-helpers';

// Cargar variables de entorno
dotenv.config();

console.log('🚀 Iniciando worker de análisis corporal...');

// Configurar conexión a Redis
const connection = new IORedis(
  process.env.REDIS_URL || 'redis://localhost:6379',
  {
    maxRetriesPerRequest: null,
  },
);

connection.on('connect', () => {
  console.log('✅ Worker conectado a Redis');
});

connection.on('error', (err) => {
  console.error('❌ Error de Redis en worker:', err);
});

// Crear worker
const worker = new Worker(
  'bodyAnalysis',
  async (job: Job) => {
    const { image, userData } = job.data;

    console.log(`🔄 Procesando trabajo ${job.id}...`);

    try {
      // Actualizar progreso
      await job.updateProgress(10);

      // Generar prompt especializado para análisis corporal
      const prompt = generateBodyAnalysisPrompt(userData);

      console.log('📡 Enviando imagen a Ollama...');
      await job.updateProgress(30);

      // Llamar a Ollama
      const response = await fetch('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llava:7b-v1.6-mistral-q4_K_M',
          prompt,
          images: [image.replace(/^data:image\/[^;]+;base64,/, '')],
          stream: false,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Error de Ollama: ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as any;
      const raw = data.response?.trim();

      if (!raw) {
        throw new Error('Respuesta vacía de Ollama');
      }

      console.log('🧠 Procesando respuesta de Ollama...');
      await job.updateProgress(60);

      // Limpiar respuesta JSON
      const cleaned = cleanJson(raw);

      if (!cleaned || !isJson(cleaned)) {
        console.warn('Respuesta de LLaVA no JSON válida:', cleaned);
        throw new Error('Respuesta de Ollama no es JSON válido');
      }

      // Corregir posibles errores de idioma
      const fixed = cleaned.replace(
        /"recomendaciones":/g,
        '"recommendations":',
      );
      const parsed = JSON.parse(fixed);

      console.log('✅ Análisis corporal procesado');
      await job.updateProgress(80);

      // Validar y limpiar análisis
      const validatedAnalysis = validateAndCleanBodyAnalysis(parsed, userData);

      console.log('🍎 Generando recomendaciones nutricionales...');
      await job.updateProgress(90);

      // Generar recomendaciones nutricionales con OpenAI
      const nutritionRecommendation = await generateNutritionRecommendation(
        validatedAnalysis,
        process.env.OPENAI_API_KEY,
      );

      const finalAnalysis: BodyAnalysisApiResponse = {
        ...validatedAnalysis,
        recommendations: nutritionRecommendation,
      };

      console.log(`✅ Trabajo ${job.id} completado exitosamente`);
      await job.updateProgress(100);

      return finalAnalysis;
    } catch (error) {
      console.error(`❌ Error procesando trabajo ${job.id}:`, error);
      throw error;
    }
  },
  {
    connection,
    concurrency: 1, // Procesar un trabajo a la vez para no sobrecargar
  },
);

// Event listeners
worker.on('completed', (job) => {
  const duration = Date.now() - job.timestamp;
  console.log(`✅ Trabajo ${job.id} completado en ${duration}ms`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Trabajo ${job?.id} falló:`, err?.message);
});

worker.on('error', (err) => {
  console.error('❌ Error del worker:', err);
});

worker.on('ready', () => {
  console.log('🎯 Worker listo para procesar trabajos');
});

// Manejar cierre graceful
process.on('SIGINT', async () => {
  console.log('⏹️ Cerrando worker...');
  await worker.close();
  await connection.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('⏹️ Cerrando worker...');
  await worker.close();
  await connection.disconnect();
  process.exit(0);
});

console.log('🔥 Worker de análisis corporal iniciado correctamente');
console.log('📱 Esperando trabajos...');
