import { IsInt, IsString, IsOptional, IsEnum, Min } from 'class-validator';

export enum XpAction {
  HABIT_COMPLETE = 'habit_complete',
  NUTRITION_LOG = 'nutrition_log',
  DAILY_COMMENT = 'daily_comment',
  DAY_COMPLETE = 'day_complete',
  STREAK_BONUS = 'streak_bonus',
  LEVEL_UP = 'level_up',
  HABIT_CREATED = 'habit_created',
  HABIT_CREATED_BY_AI = 'habit_created_by_ai',
}

export class AddXpDto {
  @IsString()
  @IsEnum(XpAction)
  action: XpAction;

  @IsInt()
  @Min(0)
  xpAmount: number;

  @IsString()
  description: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

export class XpStatsResponse {
  level: number;
  xp: number;
  totalXp: number;
  xpForNextLevel: number;
  xpProgressPercentage: number;
  streak: number;
  lastStreakDate?: string;
  recentLogs: XpLogResponse[];
}

export class XpLogResponse {
  id: string;
  action: string;
  xpEarned: number;
  description: string;
  date: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export class LevelUpResponse {
  newLevel: number;
  xpEarned: number;
  totalXpEarned: number;
  leveledUp: boolean;
  nextLevelXp: number;
  streak: number;
  streakBonus: number;
}
