import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  Max,
} from 'class-validator';

export class AdjustHydrationDto {
  @IsString()
  date: string;

  @IsInt()
  @Min(-30)
  @Max(30)
  delta: number;
}

export class SetHydrationDto {
  @IsString()
  date: string;

  @IsInt()
  @Min(0)
  @Max(30)
  glasses: number;
}

export class SetGoalDto {
  @IsInt()
  @Min(1)
  @Max(30)
  goalGlasses: number;

  @IsInt()
  @Min(50)
  @Max(1000)
  mlPerGlass: number;
}
