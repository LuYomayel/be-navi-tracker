import { IsString, IsNumber, IsOptional, IsObject } from 'class-validator';

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

export class SaveDTO {
  bodyType: string;
  confidence: number;

  fullAnalysisData: any;
  measurements: {
    bodyFat: number;
    muscleMass: number;
    bmi: number;
  };
  recommendations: string[];
}
