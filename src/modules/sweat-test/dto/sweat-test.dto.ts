import {
  IsString,
  IsInt,
  IsNumber,
  IsOptional,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

export class CreateSweatTestDto {
  @IsString()
  date: string;

  @IsOptional()
  @IsString()
  activity?: string;

  @IsInt()
  @Min(5)
  @Max(600)
  durationMin: number;

  @IsNumber()
  @Min(20)
  @Max(300)
  weightBeforeKg: number;

  @IsNumber()
  @Min(20)
  @Max(300)
  weightAfterKg: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  fluidIntakeMl?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3000)
  urineMl?: number;

  @IsOptional()
  @IsBoolean()
  indoor?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(-20)
  @Max(60)
  temperatureC?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
