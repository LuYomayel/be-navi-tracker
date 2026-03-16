import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';
import { XpAction } from '../xp/dto/xp.dto';
import {
  AdjustHydrationDto,
  SetHydrationDto,
  SetGoalDto,
} from './dto/hydration.dto';

@Injectable()
export class HydrationService {
  constructor(
    private prisma: PrismaService,
    private xpService: XpService,
  ) {}

  async getByDate(userId: string, date: string) {
    const log = await this.prisma.hydrationLog.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!log) {
      return {
        userId,
        date,
        glassesConsumed: 0,
        mlConsumed: 0,
        goalReachedAt: null,
      };
    }
    return log;
  }

  async getRange(userId: string, from: string, to: string) {
    return this.prisma.hydrationLog.findMany({
      where: {
        userId,
        date: { gte: from, lte: to },
      },
      orderBy: { date: 'asc' },
    });
  }

  async adjust(userId: string, dto: AdjustHydrationDto) {
    const goal = await this.getGoal(userId);
    const existing = await this.prisma.hydrationLog.findUnique({
      where: { userId_date: { userId, date: dto.date } },
    });

    const currentGlasses = existing?.glassesConsumed ?? 0;
    const newGlasses = Math.max(0, Math.min(30, currentGlasses + dto.delta));
    const mlConsumed = newGlasses * goal.mlPerGlass;

    const log = await this.prisma.hydrationLog.upsert({
      where: { userId_date: { userId, date: dto.date } },
      create: {
        userId,
        date: dto.date,
        glassesConsumed: newGlasses,
        mlConsumed,
      },
      update: {
        glassesConsumed: newGlasses,
        mlConsumed,
      },
    });

    await this.checkAndAwardGoalXp(userId, log, goal.goalGlasses);
    return log;
  }

  async set(userId: string, dto: SetHydrationDto) {
    const goal = await this.getGoal(userId);
    const glasses = Math.max(0, Math.min(30, dto.glasses));
    const mlConsumed = glasses * goal.mlPerGlass;

    const log = await this.prisma.hydrationLog.upsert({
      where: { userId_date: { userId, date: dto.date } },
      create: {
        userId,
        date: dto.date,
        glassesConsumed: glasses,
        mlConsumed,
      },
      update: {
        glassesConsumed: glasses,
        mlConsumed,
      },
    });

    await this.checkAndAwardGoalXp(userId, log, goal.goalGlasses);
    return log;
  }

  async getGoal(userId: string) {
    const prefs = await this.prisma.userPreferences.findFirst({
      where: { userId },
    });
    return {
      goalGlasses: prefs?.hydrationGoalGlasses ?? 8,
      mlPerGlass: prefs?.hydrationMlPerGlass ?? 250,
    };
  }

  async setGoal(userId: string, dto: SetGoalDto) {
    await this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        hydrationGoalGlasses: dto.goalGlasses,
        hydrationMlPerGlass: dto.mlPerGlass,
      },
      update: {
        hydrationGoalGlasses: dto.goalGlasses,
        hydrationMlPerGlass: dto.mlPerGlass,
      },
    });
    return { goalGlasses: dto.goalGlasses, mlPerGlass: dto.mlPerGlass };
  }

  private async checkAndAwardGoalXp(
    userId: string,
    log: any,
    goalGlasses: number,
  ) {
    if (log.glassesConsumed >= goalGlasses && !log.goalReachedAt) {
      await this.prisma.hydrationLog.update({
        where: { id: log.id },
        data: { goalReachedAt: new Date() },
      });

      await this.xpService.addXp(userId, {
        action: XpAction.HYDRATION_GOAL,
        xpAmount: 20,
        description: `Meta de hidratacion alcanzada: ${log.date}`,
        metadata: { date: log.date, glasses: log.glassesConsumed },
      });
    }
  }
}
