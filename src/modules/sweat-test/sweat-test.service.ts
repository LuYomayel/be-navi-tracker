import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import {
  computeSweatTest,
  recommendDailyIntake,
  DEFAULT_SWEAT_RATE_ML_H,
} from './sweat-rate';
import { CreateSweatTestDto } from './dto/sweat-test.dto';

@Injectable()
export class SweatTestService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateSweatTestDto) {
    let result;
    try {
      result = computeSweatTest({
        weightBeforeKg: dto.weightBeforeKg,
        weightAfterKg: dto.weightAfterKg,
        fluidIntakeMl: dto.fluidIntakeMl ?? 0,
        urineMl: dto.urineMl,
        durationMin: dto.durationMin,
      });
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Datos del test inválidos',
      );
    }

    return this.prisma.sweatTest.create({
      data: {
        userId,
        date: dto.date,
        activity: dto.activity ?? null,
        durationMin: dto.durationMin,
        weightBeforeKg: dto.weightBeforeKg,
        weightAfterKg: dto.weightAfterKg,
        fluidIntakeMl: dto.fluidIntakeMl ?? 0,
        urineMl: dto.urineMl ?? null,
        indoor: dto.indoor ?? null,
        temperatureC: dto.temperatureC ?? null,
        notes: dto.notes ?? null,
        sweatMl: result.sweatMl,
        sweatRateMlPerHour: result.sweatRateMlPerHour,
        netDeficitMl: result.netDeficitMl,
        pctBodyWeightLost: result.pctBodyWeightLost,
        level: result.level,
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.sweatTest.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });
  }

  async remove(userId: string, id: string) {
    const test = await this.prisma.sweatTest.findFirst({
      where: { id, userId },
    });
    if (!test) throw new NotFoundException('Test de sudoración no encontrado');
    return this.prisma.sweatTest.delete({ where: { id } });
  }

  async getStats(userId: string) {
    const tests = await this.prisma.sweatTest.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
    });

    if (tests.length === 0) {
      return {
        count: 0,
        avgRateMlPerHour: null,
        maxRateMlPerHour: null,
        minRateMlPerHour: null,
        indoorAvgMlPerHour: null,
        outdoorAvgMlPerHour: null,
        lastTest: null,
      };
    }

    const rates = tests.map((t) => t.sweatRateMlPerHour);
    const avg = (list: number[]) =>
      list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null;

    return {
      count: tests.length,
      avgRateMlPerHour: avg(rates),
      maxRateMlPerHour: Math.max(...rates),
      minRateMlPerHour: Math.min(...rates),
      indoorAvgMlPerHour: avg(
        tests.filter((t) => t.indoor === true).map((t) => t.sweatRateMlPerHour),
      ),
      outdoorAvgMlPerHour: avg(
        tests.filter((t) => t.indoor === false).map((t) => t.sweatRateMlPerHour),
      ),
      lastTest: tests[0],
    };
  }

  /**
   * Cuánta agua necesita por día según su tasa medida: un día que entrena y
   * uno de descanso. Una meta fija no sirve — los días de entrenamiento queda
   * corto y los de descanso sobra.
   */
  async getRecommendation(userId: string, trainingHours = 2) {
    const prefs = await this.prisma.userPreferences.findFirst({
      where: { userId },
    });

    let weightKg = prefs?.currentWeight ?? null;
    if (!weightKg) {
      const lastWeight = await this.prisma.weightEntry.findFirst({
        where: { userId },
        orderBy: { date: 'desc' },
      });
      weightKg = lastWeight?.weight ?? null;
    }
    if (!weightKg) {
      throw new BadRequestException(
        'Necesito tu peso para calcular la recomendación: registrá un pesaje o completá tus preferencias',
      );
    }

    const stats = await this.getStats(userId);
    const measuredRate = stats.avgRateMlPerHour;
    const creatine = prefs?.takesCreatine ?? false;

    const trainingDay = recommendDailyIntake({
      weightKg,
      sweatRateMlPerHour: measuredRate ?? undefined,
      trainingHours,
      creatine,
    });
    const restDay = recommendDailyIntake({
      weightKg,
      sweatRateMlPerHour: measuredRate ?? undefined,
      trainingHours: 0,
      creatine,
    });

    const currentGoalMl =
      (prefs?.hydrationGoalGlasses ?? 8) * (prefs?.hydrationMlPerGlass ?? 250);

    return {
      weightKg,
      trainingHours,
      creatine,
      sweatRateMlPerHour: measuredRate ?? DEFAULT_SWEAT_RATE_ML_H,
      estimated: measuredRate == null,
      testsCount: stats.count,
      trainingDay,
      restDay,
      currentGoalMl,
      gapTrainingMl: Math.max(0, trainingDay.drinkMl - currentGoalMl),
      gapRestMl: Math.max(0, restDay.drinkMl - currentGoalMl),
    };
  }
}
