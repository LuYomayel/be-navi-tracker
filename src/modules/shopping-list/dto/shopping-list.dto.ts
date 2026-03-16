import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsArray,
  Min,
} from 'class-validator';

export class CreateShoppingListDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateShoppingListDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  status?: 'active' | 'archived';
}

export class GenerateShoppingListDto {
  @IsOptional()
  @IsString()
  mealPrepId?: string;

  @IsOptional()
  @IsString()
  name?: string;
}

export class CreateShoppingItemDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  quantity?: string;

  @IsString()
  category: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class UpdateShoppingItemDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  quantity?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  checked?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}

export class BulkCheckDto {
  @IsArray()
  @IsString({ each: true })
  itemIds: string[];

  @IsBoolean()
  checked: boolean;
}
