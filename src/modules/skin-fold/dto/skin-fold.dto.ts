import {
  IsString,
  IsOptional,
  IsNumber,
  IsObject,
  IsDateString,
  Min,
  Max,
} from 'class-validator';

export type SkinFoldSite =
  | 'triceps'
  | 'subscapular'
  | 'suprailiac'
  | 'abdominal'
  | 'thigh'
  | 'chest'
  | 'midaxillary'
  | 'biceps'
  | 'calf';

export class CreateSkinFoldRecordDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  technician?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsObject()
  values: Partial<Record<SkinFoldSite, number>>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  aiConfidence?: number;
}

export class UpdateSkinFoldRecordDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  technician?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  values?: Partial<Record<SkinFoldSite, number>>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  aiConfidence?: number;
}

export class AnalyzeSkinFoldDto {
  @IsString()
  imageBase64: string;

  @IsObject()
  user: {
    age: number;
    height: number;
    weight: number;
    gender: string;
  };
}

export interface SkinFoldRecord {
  id: string;
  userId: string;
  date: string;
  technician?: string;
  notes?: string;
  values: Partial<Record<SkinFoldSite, number>>;
  aiConfidence?: number;
  createdAt: Date;
  updatedAt: Date;
}
