import { IsString, IsNotEmpty, IsOptional, IsNumber } from 'class-validator';

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
}
