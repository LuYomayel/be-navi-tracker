// Cargar .env al process.env de forma deterministica, antes de cualquier otro
// import (asi todas las env vars — JWT_SECRET, RESEND_API_KEY, etc. — estan
// disponibles para el fail-fast y los servicios, sin depender de pm2/Prisma).
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, RequestMethod } from '@nestjs/common';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

import { webcrypto } from 'crypto';
if (!global.crypto) {
  // @ts-ignore – añadimos propiedad fuera de typings
  global.crypto = webcrypto;
}
async function bootstrap() {
  // Fail-fast: en produccion los secretos JWT son obligatorios. Sin ellos el
  // MCP/Auth caeria a un fallback conocido y cualquiera podria forjar tokens.
  if (process.env.NODE_ENV === 'production') {
    for (const key of ['JWT_SECRET', 'JWT_REFRESH_SECRET']) {
      if (!process.env[key]) {
        throw new Error(`Variable de entorno requerida faltante: ${key}`);
      }
    }
  }

  const app = await NestFactory.create(AppModule);

  // Configurar límites de tamaño para imágenes base64
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  // Habilitar CORS para el frontend
  app.enableCors({
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'https://navi-tracker.netlify.app',
      'https://navi-tracker.luciano-yomayel.com',
      process.env.CORS_ORIGIN,
    ].filter(Boolean),
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Configurar validación global
  app.useGlobalPipes(new ValidationPipe());

  // Usar filtro global para formatear errores
  const { HttpExceptionFilter } = await import(
    './common/filters/http-exception.filter'
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // Configurar prefijo global para la API.
  // El connector MCP (Streamable HTTP) y su OAuth Authorization Server deben
  // vivir en la raiz (Claude espera /mcp y /.well-known/oauth-*), por eso se
  // excluyen del prefijo /api.
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'mcp', method: RequestMethod.ALL },
      {
        path: '.well-known/oauth-protected-resource',
        method: RequestMethod.GET,
      },
      {
        path: '.well-known/oauth-authorization-server',
        method: RequestMethod.GET,
      },
      { path: 'oauth/authorize', method: RequestMethod.ALL },
      { path: 'oauth/token', method: RequestMethod.POST },
      { path: 'oauth/register', method: RequestMethod.POST },
    ],
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);

  console.log(`🚀 Backend running on http://localhost:${port}`);
  console.log(`📸 Body size limit: 50MB (for image uploads)`);
  console.log(`🔗 CORS origin: ${process.env.CORS_ORIGIN}`);
}
bootstrap();
