import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { Prisma } from '@prisma/client';

export interface StreakResult {
  streak: number;
  streakBonus: number;
  streakType: 'habits' | 'nutrition' | 'activity';
  isNewRecord?: boolean;
}

@Injectable()
export class StreakService {
  constructor(private prisma: PrismaService) {}

  /**
   * Calcula el bonus de racha basado en los días
   */
  private calculateStreakBonus(streakDays: number, multiplier: number): number {
    if (streakDays <= 1) return 0;
    return Math.min((streakDays - 1) * multiplier, 100);
  }

  /**
   * Verifica si todos los hábitos del día están completados
   */
  async checkDailyHabitsCompletion(
    userId: string,
    date: string,
  ): Promise<boolean> {
    // Obtener todas las actividades activas del usuario
    const activities = await this.prisma.activity.findMany({
      where: {
        userId,
        // No incluir actividades archivadas si tienes ese campo
      },
      include: {
        completions: {
          where: { date },
        },
      },
    });

    if (activities.length === 0) return false;

    // Verificar qué hábitos están programados para este día
    const dayOfWeek = new Date(date).getDay();
    const dayIndex = (dayOfWeek + 6) % 7; // Convertir domingo=6

    const scheduledActivities = activities.filter((activity) => {
      const days = Array.isArray(activity.days)
        ? activity.days
        : JSON.parse(activity.days as string);
      return days[dayIndex] === true;
    });

    if (scheduledActivities.length === 0) return false;

    // Verificar que todos los hábitos programados estén completados
    const completedActivities = scheduledActivities.filter((activity) =>
      activity.completions.some((completion) => completion.completed),
    );
    scheduledActivities.forEach((activity) => {
      console.log('activity', activity.name, activity.completions);
    });

    return completedActivities.length === scheduledActivities.length;
  }

  /**
   * Verifica si se registraron al menos 3 comidas en el día
   */
  async checkDailyNutritionCompletion(
    userId: string,
    date: string,
  ): Promise<boolean> {
    const nutritionCount = await this.prisma.nutritionAnalysis.count({
      where: {
        userId,
        date,
      },
    });

    return nutritionCount >= 3;
  }

  /**
   * Verifica si se registró al menos 1 actividad física en el día
   */
  async checkDailyActivityCompletion(
    userId: string,
    date: string,
  ): Promise<boolean> {
    const activityCount = await this.prisma.physicalActivity.count({
      where: {
        userId,
        date,
      },
    });

    return activityCount >= 1;
  }

  /**
   * Actualiza la racha de hábitos
   */
  async updateHabitStreak(userId: string, date: string): Promise<StreakResult> {
    const isCompleted = await this.checkDailyHabitsCompletion(userId, date);

    const { userStreak, streakType } = await this.getUserStreak(
      userId,
      'habits',
    );

    if (!isCompleted) {
      // Resetear si no se cumplió criterio hoy
      if (userStreak.count !== 0) {
        await this.prisma.userStreak.update({
          where: { id: userStreak.id },
          data: { count: 0, lastDate: null },
        });
      }
      return {
        streak: 0,
        streakBonus: 0,
        streakType: 'habits',
      };
    }

    const today = new Date(date);
    const lastDate = userStreak.lastDate ? new Date(userStreak.lastDate) : null;
    let newCount = 1;

    if (lastDate) {
      const diff = Math.floor(
        (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diff === 1) newCount = userStreak.count + 1;
      else if (diff === 0) newCount = userStreak.count;
      else newCount = 1;
    }

    const updated = await this.prisma.userStreak.update({
      where: { id: userStreak.id },
      data: { count: newCount, lastDate: date },
    });

    const streakBonus = this.calculateStreakBonus(
      newCount,
      streakType.bonusMultiplier,
    );

    return {
      streak: updated.count,
      streakBonus,
      streakType: 'habits',
      isNewRecord: newCount > userStreak.count,
    };
  }

  /**
   * Actualiza la racha de nutrición
   */
  async updateNutritionStreak(
    userId: string,
    date: string,
  ): Promise<StreakResult> {
    const isCompleted = await this.checkDailyNutritionCompletion(userId, date);

    const { userStreak, streakType } = await this.getUserStreak(
      userId,
      'nutrition',
    );

    if (!isCompleted) {
      if (userStreak.count !== 0) {
        await this.prisma.userStreak.update({
          where: { id: userStreak.id },
          data: { count: 0, lastDate: null },
        });
      }
      return {
        streak: userStreak.count,
        streakBonus: 0,
        streakType: 'nutrition',
      };
    }

    const today = new Date(date);
    const lastDate = userStreak.lastDate ? new Date(userStreak.lastDate) : null;
    let newCount = 1;

    if (lastDate) {
      const diff = Math.floor(
        (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diff === 1) newCount = userStreak.count + 1;
      else if (diff === 0) newCount = userStreak.count;
      else newCount = 1;
    }

    const updated = await this.prisma.userStreak.update({
      where: { id: userStreak.id },
      data: { count: newCount, lastDate: date },
    });

    const streakBonus = this.calculateStreakBonus(
      newCount,
      streakType.bonusMultiplier,
    );

    return {
      streak: updated.count,
      streakBonus,
      streakType: 'nutrition',
      isNewRecord: newCount > userStreak.count,
    };
  }

  /**
   * Actualiza la racha de actividad física
   */
  async updateActivityStreak(
    userId: string,
    date: string,
  ): Promise<StreakResult> {
    const isCompleted = await this.checkDailyActivityCompletion(userId, date);

    const { userStreak, streakType } = await this.getUserStreak(
      userId,
      'activity',
    );

    if (!isCompleted) {
      return {
        streak: userStreak.count,
        streakBonus: 0,
        streakType: 'activity',
      };
    }

    const today = new Date(date);
    const lastDate = userStreak.lastDate ? new Date(userStreak.lastDate) : null;
    let newCount = 1;

    if (lastDate) {
      const diff = Math.floor(
        (today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (diff === 1) newCount = userStreak.count + 1;
      else if (diff === 0) newCount = userStreak.count;
      else newCount = 1;
    }

    const updated = await this.prisma.userStreak.update({
      where: { id: userStreak.id },
      data: { count: newCount, lastDate: date },
    });

    const streakBonus = this.calculateStreakBonus(
      newCount,
      streakType.bonusMultiplier,
    );

    return {
      streak: updated.count,
      streakBonus,
      streakType: 'activity',
      isNewRecord: newCount > userStreak.count,
    };
  }

  /**
   * Obtiene todas las rachas del usuario
   */
  async getAllStreaks(userId: string): Promise<{
    habits: { streak: number; lastDate: string | null };
    nutrition: { streak: number; lastDate: string | null };
    activity: { streak: number; lastDate: string | null };
  }> {
    const streaks = await this.prisma.userStreak.findMany({
      where: { userId },
      include: { streakType: true },
    });

    const map: Record<string, { streak: number; lastDate: string | null }> = {};
    streaks.forEach((s) => {
      map[s.streakType.code] = { streak: s.count, lastDate: s.lastDate };
    });

    return {
      habits: map['habits'] || { streak: 0, lastDate: null },
      nutrition: map['nutrition'] || { streak: 0, lastDate: null },
      activity: map['activity'] || { streak: 0, lastDate: null },
    };
  }

  /**
   * Verifica y actualiza rachas al final del día (para cron job)
   */
  async checkEndOfDayStreaks(userId: string, date: string): Promise<any> {
    // Verificar nutrición (si no se completaron 3 comidas, resetear racha)

    const nutritionCompleted = await this.checkDailyNutritionCompletion(
      userId,
      date,
    );
    console.log('nutritionCompleted', nutritionCompleted);
    if (!nutritionCompleted) {
      const { userStreak } = await this.getUserStreak(userId, 'nutrition');
      if (userStreak.count !== 0) {
        const updated = await this.prisma.userStreak.update({
          where: { id: userStreak.id },
          data: { count: 0, lastDate: null },
        });
        console.log('Racha de nutrición rota', updated);
      }
    }

    // Verificar actividad física (reset opcional)
    const physicalActivityCompleted = await this.checkDailyActivityCompletion(
      userId,
      date,
    );

    if (!physicalActivityCompleted) {
      const { userStreak } = await this.getUserStreak(userId, 'activity');
      if (userStreak.count !== 0) {
        const updated = await this.prisma.userStreak.update({
          where: { id: userStreak.id },
          data: { count: 0, lastDate: null },
        });
        console.log('Racha de actividad física rota', updated);
      }
    }

    const habitsCompleted = await this.checkDailyHabitsCompletion(userId, date);
    if (!habitsCompleted) {
      const { userStreak } = await this.getUserStreak(userId, 'habits');
      if (userStreak.count !== 0) {
        const updated = await this.prisma.userStreak.update({
          where: { id: userStreak.id },
          data: { count: 0, lastDate: null },
        });
        console.log('Racha de hábitos rota', updated);
      }
    }

    return {
      nutritionCompleted,
      physicalActivityCompleted,
      habitsCompleted,
    };
  }

  /** Obtiene (o crea) un tipo de racha */
  private async getOrCreateStreakType(
    code: 'habits' | 'nutrition' | 'activity' | string,
  ) {
    const defaults: Record<string, { name: string; bonusMultiplier: number }> =
      {
        habits: { name: 'Racha de Hábitos', bonusMultiplier: 10 },
        nutrition: { name: 'Racha de Nutrición', bonusMultiplier: 8 },
        activity: { name: 'Racha de Actividad Física', bonusMultiplier: 6 },
      };

    const def = defaults[code] || { name: code, bonusMultiplier: 5 };

    const streakType = await this.prisma.streakType.upsert({
      where: { code },
      update: {},
      create: {
        code,
        name: def.name,
        bonusMultiplier: def.bonusMultiplier,
      },
    });
    return streakType;
  }

  /** Obtiene o crea la racha de un usuario para un tipo */
  private async getUserStreak(userId: string, code: string) {
    const streakType = await this.getOrCreateStreakType(code);
    const userStreak = await this.prisma.userStreak.upsert({
      where: {
        userId_streakTypeId: {
          userId,
          streakTypeId: streakType.id,
        },
      },
      update: {},
      create: {
        userId,
        streakTypeId: streakType.id,
      },
    });
    return { userStreak, streakType };
  }
}
