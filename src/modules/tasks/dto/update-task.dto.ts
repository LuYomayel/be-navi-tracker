import {
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
  IsNumber,
  IsArray,
  IsObject,
  Matches,
  MaxLength,
} from 'class-validator';

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dueDate?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/)
  dueTime?: string;

  @IsOptional()
  @IsIn(['low', 'medium', 'high', 'urgent'])
  priority?: string;

  @IsOptional()
  @IsIn(['pending', 'in_progress', 'completed'])
  status?: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  project?: string;

  // null = sacarle el proyecto
  @IsOptional()
  @IsString()
  projectId?: string | null;

  // null = sacarle el hito
  @IsOptional()
  @IsString()
  milestoneId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsNumber()
  order?: number;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsObject()
  recurrenceRule?: {
    frequency: 'daily' | 'weekly' | 'monthly';
    days?: boolean[];
    endDate?: string;
  };
}
