import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';
import { SweatTestService } from '../sweat-test/sweat-test.service';
import { XpAction } from '../xp/dto/xp.dto';
import { getLocalDateString } from '../../common/utils/date.utils';
import {
  AdjustHydrationDto,
  SetHydrationDto,
  SetGoalDto,
} from './dto/hydration.dto';
import {
  computePace,
  validateBlocks,
  DEFAULT_HYDRATION_BLOCKS,
  HydrationBlock,
} from './hydration-pace';

/** Minutos desde medianoche en hora argentina. */
function nowMinutesART(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Buenos_Aires',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const h = parseInt(parts.find((p) => p.type === 'hour')!.value, 10);
  const m = parseInt(parts.find((p) => p.type === 'minute')!.value, 10);
  return h * 60 + m;
}

@Injectable()
export class HydrationService {
  constructor(
    private prisma: PrismaService,
    private xpService: XpService,
    private sweatTests: SweatTestService,
  ) {}

  /**
   * Tramos del día que entrena, sacados del test de sudoración (la fórmula
   * ya existía pero no la usaba nadie: un día de handball caía igual a los
   * tramos hardcodeados). Si no hay peso registrado no se puede calcular y
   * se vuelve al default de siempre.
   */
  private async trainingBlocks(userId: string): Promise<HydrationBlock[] | null> {
    try {
      const rec = await this.sweatTests.getRecommendation(userId);
      const blocks = rec?.trainingDay?.suggestedBlocks;
      return blocks?.length ? (blocks as HydrationBlock[]) : null;
    } catch {
      return null;
    }
  }

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

    await this.checkGoalAndAwardXp(userId, log, goal.goalGlasses);
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

    await this.checkGoalAndAwardXp(userId, log, goal.goalGlasses);
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

  /**
   * Meta del día: si hay tramos configurados, la meta es la SUMA en ml de los
   * tramos activos (el de entrenamiento solo cuenta los días que entrena);
   * si no, la meta clásica por vasos.
   */
  private async checkGoalAndAwardXp(
    userId: string,
    log: any,
    goalGlasses: number,
  ) {
    const prefs = await this.prisma.userPreferences.findFirst({
      where: { userId },
    });
    const configured = prefs?.hydrationBlocks as unknown as HydrationBlock[] | null;
    const trainingActive = await this.isTrainingActive(userId, log.date, log);
    // La meta que premia tiene que ser la MISMA que muestra el ritmo: sin
    // tramos propios y en día de entrenamiento, la del test de sudoración.
    const blocks =
      configured?.length
        ? configured
        : trainingActive
          ? await this.trainingBlocks(userId)
          : null;
    if (blocks?.length) {
      const totalMl = blocks
        .filter((b) => !b.requiresTraining || trainingActive)
        .reduce((a, b) => a + b.targetMl, 0);
      if (log.mlConsumed >= totalMl && !log.goalReachedAt) {
        await this.awardGoalXp(userId, log);
      }
      return;
    }
    if (log.glassesConsumed >= goalGlasses && !log.goalReachedAt) {
      await this.awardGoalXp(userId, log);
    }
  }

  private async awardGoalXp(userId: string, log: any) {
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

  /** Toggle manual del log del día gana; si es null, cuenta la actividad física registrada. */
  private async isTrainingActive(
    userId: string,
    date: string,
    log?: { trainingDay?: boolean | null } | null,
  ): Promise<boolean> {
    if (log && log.trainingDay !== null && log.trainingDay !== undefined) {
      return log.trainingDay;
    }
    const activity = await this.prisma.physicalActivity.findFirst({
      where: { userId, date },
    });
    return !!activity;
  }

  /**
   * Ritmo de hidratación por tramos: cuánto debería llevar tomado AHORA y
   * cuánto le falta para ir a ritmo. Base de los recordatorios graduales.
   */
  async getPace(userId: string, date?: string, nowMinutesOverride?: number) {
    const day = date || getLocalDateString();
    const prefs = await this.prisma.userPreferences.findFirst({
      where: { userId },
    });
    const configured = prefs?.hydrationBlocks as unknown as HydrationBlock[] | null;

    const log = await this.prisma.hydrationLog.findUnique({
      where: { userId_date: { userId, date: day } },
    });
    const trainingActive = await this.isTrainingActive(userId, day, log);

    // Tramos propios > recomendación del test de sudoración (solo si entrena)
    // > default hardcodeado.
    let blocks = configured?.length ? configured : DEFAULT_HYDRATION_BLOCKS;
    if (!configured?.length && trainingActive) {
      blocks = (await this.trainingBlocks(userId)) ?? DEFAULT_HYDRATION_BLOCKS;
    }
    // Un dia pasado se evalua completo (24h) y uno futuro todavia no arranco:
    // la hora actual solo prorratea el dia de HOY.
    const today = getLocalDateString();
    const nowMinutes =
      nowMinutesOverride ??
      (day < today ? 24 * 60 : day > today ? 0 : nowMinutesART());

    const pace = computePace(
      blocks,
      nowMinutes,
      log?.mlConsumed ?? 0,
      trainingActive,
    );
    return {
      ...pace,
      date: day,
      configured: !!configured?.length,
      mlPerGlass: prefs?.hydrationMlPerGlass ?? 250,
      trainingDayManual: log?.trainingDay ?? null,
    };
  }

  async setBlocks(userId: string, blocks: HydrationBlock[]) {
    try {
      validateBlocks(blocks);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Tramos inválidos',
      );
    }
    await this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, hydrationBlocks: blocks as any },
      update: { hydrationBlocks: blocks as any },
    });
    return blocks;
  }

  async setTrainingToday(userId: string, date: string, value: boolean | null) {
    return this.prisma.hydrationLog.upsert({
      where: { userId_date: { userId, date } },
      create: {
        userId,
        date,
        glassesConsumed: 0,
        mlConsumed: 0,
        trainingDay: value,
      },
      update: { trainingDay: value },
    });
  }
}
