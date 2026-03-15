import { IsString, IsNotEmpty, IsOptional, IsNumber, IsArray } from 'class-validator';

export class SaveNoteDto {
  @IsString()
  @IsNotEmpty()
  date: string;

  @IsString()
  @IsNotEmpty()
  content: string;

  @IsNumber()
  @IsOptional()
  mood?: number;

  @IsArray()
  @IsOptional()
  predefinedComments?: string[];

  @IsString()
  @IsOptional()
  customComment?: string;
}
