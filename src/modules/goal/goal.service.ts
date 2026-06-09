import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { getLocalDateString } from '../../common/utils/date.utils';

export interface CreateGoalInput {
  name: string;
  targetUsd: number;
  description?: string;
  currentUsd?: number;
  startDate?: string;
  targetDate?: string;
}

export interface UpdateGoalInput {
  name?: string;
  description?: string;
  targetUsd?: number;
  currentUsd?: number;
  startDate?: string;
  targetDate?: string;
  status?: string;
}

export interface LogContributionInput {
  amountUsd: number;
  description?: string;
  date?: string;
}

/**
 * Objetivos con seguimiento de fondo (ej: fondo Nueva Zelanda USD 8.000).
 * Cada aporte se registra como GoalContribution y acumula en `currentUsd`.
 */
@Injectable()
export class GoalService {
  constructor(private prisma: PrismaService) {}

  async getAll(userId: string) {
    return this.prisma.goal.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** El objetivo activo más reciente del usuario (o null). */
  async getActive(userId: string) {
    return this.prisma.goal.findFirst({
      where: { userId, status: 'active' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getById(id: string, userId: string) {
    return this.prisma.goal.findFirst({ where: { id, userId } });
  }

  async create(data: CreateGoalInput, userId: string) {
    return this.prisma.goal.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        targetUsd: data.targetUsd,
        currentUsd: data.currentUsd ?? 0,
        startDate: data.startDate ?? getLocalDateString(),
        targetDate: data.targetDate,
      },
    });
  }

  /** Actualiza con chequeo de pertenencia (updateMany por id + userId). */
  async update(id: string, data: UpdateGoalInput, userId: string) {
    return this.prisma.goal.updateMany({
      where: { id, userId },
      data,
    });
  }

  /**
   * Registra un aporte al fondo: crea un GoalContribution e incrementa
   * `currentUsd`. Si no se pasa `goalId`, usa el objetivo activo. Marca el
   * objetivo como `achieved` al alcanzar el target.
   * Devuelve `{ goal, contribution }`, o `null` si el usuario no tiene objetivo.
   */
  async logContribution(
    userId: string,
    input: LogContributionInput,
    goalId?: string,
  ) {
    const goal = goalId
      ? await this.getById(goalId, userId)
      : await this.getActive(userId);
    if (!goal) return null;

    const contribution = await this.prisma.goalContribution.create({
      data: {
        goalId: goal.id,
        userId,
        amountUsd: input.amountUsd,
        description: input.description,
        date: input.date ?? getLocalDateString(),
      },
    });

    const newCurrent = goal.currentUsd + input.amountUsd;
    const justAchieved = newCurrent >= goal.targetUsd && goal.status === 'active';
    const goalUpdated = await this.prisma.goal.update({
      where: { id: goal.id },
      data: {
        currentUsd: newCurrent,
        ...(justAchieved ? { status: 'achieved' } : {}),
      },
    });

    return { goal: goalUpdated, contribution };
  }

  /**
   * Progreso del objetivo (activo, o el más reciente si no hay activo):
   * porcentaje (cap 100), USD restantes y días hasta `targetDate`.
   * Devuelve `null` si el usuario no tiene ningún objetivo.
   */
  async getProgress(userId: string) {
    const goal =
      (await this.prisma.goal.findFirst({
        where: { userId, status: 'active' },
        orderBy: { createdAt: 'desc' },
        include: { contributions: { orderBy: { date: 'desc' } } },
      })) ??
      (await this.prisma.goal.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        include: { contributions: { orderBy: { date: 'desc' } } },
      }));
    if (!goal) return null;

    const percentage =
      goal.targetUsd > 0
        ? Math.min(100, (goal.currentUsd / goal.targetUsd) * 100)
        : 0;
    const remainingUsd = Math.max(0, goal.targetUsd - goal.currentUsd);

    let daysRemaining: number | null = null;
    if (goal.targetDate) {
      const today = new Date(`${getLocalDateString()}T12:00:00`);
      const target = new Date(`${goal.targetDate}T12:00:00`);
      daysRemaining = Math.ceil(
        (target.getTime() - today.getTime()) / 86_400_000,
      );
    }

    return { goal, percentage, remainingUsd, daysRemaining };
  }
}
