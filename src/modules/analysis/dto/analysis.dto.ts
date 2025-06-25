import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateAnalysisDto {
  @IsDateString()
  date: string;

  @IsArray()
  @IsString({ each: true })
  detectedPatterns: string[];

  @IsInt()
  @Min(1)
  @Max(5)
  mood: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class GetRecentAnalysisDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}
