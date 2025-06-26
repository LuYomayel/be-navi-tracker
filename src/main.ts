import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as bodyParser from 'body-parser';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Configurar límites de tamaño para imágenes base64
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

  // Habilitar CORS para el frontend
  app.enableCors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Configurar validación global
  app.useGlobalPipes(new ValidationPipe());

  // Configurar prefijo global para la API
  app.setGlobalPrefix('api');

  const port = process.env.PORT || 4000;
  await app.listen(port);

  console.log(`🚀 Backend running on http://localhost:${port}`);
  console.log(`📸 Body size limit: 50MB (for image uploads)`);
}
bootstrap();
