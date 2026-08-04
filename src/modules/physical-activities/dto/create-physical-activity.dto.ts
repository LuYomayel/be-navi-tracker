import { IsNumber, IsOptional, IsString } from 'class-validator';

/**
 * Con `whitelist: true` en el ValidationPipe global, toda propiedad SIN
 * decorador se descarta del body. Por eso van decorados todos los campos,
 * incluido `context` (lo lee el controller para el analisis de imagen y antes
 * ni figuraba en el DTO).
 *
 * Se dejan opcionales a proposito: este DTO no validaba nada, y la idea es
 * conservar los campos, no empezar a rechazar payloads que antes entraban.
 */
export class CreatePhysicalActivityDto {
  @IsOptional()
  @IsString()
  date: string; // '2025-06-30'

  @IsOptional()
  @IsNumber()
  steps?: number;

  @IsOptional()
  @IsNumber()
  distanceKm?: number;

  @IsOptional()
  @IsNumber()
  activeEnergyKcal?: number;

  @IsOptional()
  @IsNumber()
  exerciseMinutes?: number;

  @IsOptional()
  @IsNumber()
  standHours?: number;

  @IsOptional()
  @IsString()
  screenshotUrl?: string;

  @IsOptional()
  @IsString()
  source: string;

  @IsOptional()
  @IsNumber()
  aiConfidence?: number;

  /** Contexto que escribe el usuario para mejorar el analisis de la imagen. */
  @IsOptional()
  @IsString()
  context?: string;
}
