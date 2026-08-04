import {
  Allow,
  IsString,
  IsNumber,
  IsOptional,
  IsObject,
} from 'class-validator';

export class SaveBodyAnalysisDto {
  @IsString()
  bodyType: string;

  @IsOptional()
  @IsObject()
  measurements?: {
    bodyFat?: number;
    muscleMass?: number;
    bmi?: number;
  };

  @IsOptional()
  @IsNumber()
  confidence?: number;

  // Objeto completo devuelto por la IA
  @IsOptional()
  @IsObject()
  fullAnalysisData?: any;

  // URL de la imagen asociada (opcional)
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsObject()
  recommendations?: string[];

  @IsOptional()
  @IsObject()
  progress?: any;

  @IsOptional()
  @IsString()
  disclaimer?: string;

  @IsOptional()
  @IsObject()
  insights?: string[];

  @IsOptional()
  rawAnalysis?: any;
}

/**
 * Payload de POST /body-analysis/save. Con `whitelist: true` en el
 * ValidationPipe global, una propiedad sin decorador se descarta del body: por
 * eso van todas con @Allow(), que las conserva sin imponerles forma (son
 * blobs que arma la IA y cambian de shape).
 */
export class SaveDTO {
  @Allow()
  bodyType: string;

  @Allow()
  confidence: number;

  @Allow()
  fullAnalysisData: any;

  @Allow()
  measurements: {
    bodyFat: number;
    muscleMass: number;
    bmi: number;
  };

  @Allow()
  recommendations: string[];
}
