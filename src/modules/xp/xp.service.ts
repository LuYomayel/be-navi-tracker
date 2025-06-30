import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import {
  AddXpDto,
  XpAction,
  XpStatsResponse,
  LevelUpResponse,
} from './dto/xp.dto';

@Injectable()
export class XpService {
  constructor(private prisma: PrismaService) {}

  /**
   * Calcula la XP requerida para un nivel específico
   * Progresión: Nivel 1 = 100, Nivel 2 = 220, Nivel 3 = 360, etc.
   * Formula: 100 + (nivel-1) * 20 * nivel
   */
  calculateXpForLevel(level: number): number {
    if (level === 1) return 100;
    let totalXp = 100;
    for (let i = 2; i <= level; i++) {
      totalXp += 100 + (i - 1) * 20;
    }
    return totalXp;
  }

  /**
   * Calcula el nivel basado en la XP total
   */
  calculateLevelFromTotalXp(totalXp: number): number {
    let level = 1;
    let requiredXp = 100;

    while (totalXp >= requiredXp) {
      level++;
      const nextLevelXp = 100 + (level - 1) * 20;
      requiredXp += nextLevelXp;
    }

    return Math.max(1, level - 1);
  }

  /**
   * Calcula el bonus de racha
   * Día 1: sin bonus, Día 2: +5 XP, Día 3: +10 XP, etc.
   */
  calculateStreakBonus(streakDays: number): number {
    if (streakDays <= 1) return 0;
    return Math.min((streakDays - 1) * 5, 50); // Máximo 50 XP de bonus
  }

  /**
   * Actualiza la racha del usuario
   */
  async updateStreak(
    userId: string,
    date: string,
  ): Promise<{ streak: number; streakBonus: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    const today = new Date(date);
    const lastStreakDate = user.lastStreakDate
      ? new Date(user.lastStreakDate)
      : null;

    let newStreak = 1;

    if (lastStreakDate) {
      const daysDiff = Math.floor(
        (today.getTime() - lastStreakDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysDiff === 1) {
        // Día consecutivo
        newStreak = user.streak + 1;
      } else if (daysDiff === 0) {
        // Mismo día, mantener racha
        newStreak = user.streak;
      } else {
        // Se rompió la racha
        newStreak = 1;
      }
    }

    const streakBonus = this.calculateStreakBonus(newStreak);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        streak: newStreak,
        lastStreakDate: date,
      },
    });

    return { streak: newStreak, streakBonus };
  }

  /**
   * Agrega XP al usuario
   */
  async addXp(
    userId: string,
    addXpDto: AddXpDto,
    date?: string,
  ): Promise<LevelUpResponse> {
    try {
      const currentDate = date || new Date().toISOString().split('T')[0];

      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new Error('Usuario no encontrado');
      }

      let { xpAmount } = addXpDto;
      let streakBonus = 0;
      let updatedStreak = user.streak;

      // Calcular bonus de racha para acciones que lo ameriten
      if (
        addXpDto.action === XpAction.HABIT_COMPLETE ||
        addXpDto.action === XpAction.DAY_COMPLETE
      ) {
        const streakResult = await this.updateStreak(userId, currentDate);
        updatedStreak = streakResult.streak;
        streakBonus = streakResult.streakBonus;

        // Agregar bonus a la XP
        xpAmount += streakBonus;
      }

      const oldLevel = user.level;
      const newTotalXp = user.totalXp + xpAmount;
      const newLevel = this.calculateLevelFromTotalXp(newTotalXp);
      const nextLevelXp = this.calculateXpForLevel(newLevel + 1);
      const currentLevelXp = this.calculateXpForLevel(newLevel);
      const newXp = newTotalXp - currentLevelXp;

      const leveledUp = newLevel > oldLevel;

      // Actualizar usuario
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          level: newLevel,
          xp: newXp,
          totalXp: newTotalXp,
          streak: updatedStreak,
        },
      });

      // Crear log de XP
      await this.prisma.xpLog.create({
        data: {
          userId: user.id,
          action: addXpDto.action,
          xpEarned: xpAmount,
          description: addXpDto.description,
          date: currentDate,
          metadata: {
            ...addXpDto.metadata,
            streakBonus,
            streak: updatedStreak,
            levelBefore: oldLevel,
            levelAfter: newLevel,
          },
        },
      });

      // Si subió de nivel, crear log adicional
      if (leveledUp) {
        await this.prisma.xpLog.create({
          data: {
            userId: user.id,
            action: XpAction.LEVEL_UP,
            xpEarned: 0,
            description: `¡Has alcanzado el nivel ${newLevel}! 🎉`,
            date: currentDate,
            metadata: {
              newLevel,
              oldLevel,
            },
          },
        });
      }

      return {
        newLevel,
        xpEarned: xpAmount,
        totalXpEarned: newTotalXp,
        leveledUp,
        nextLevelXp: nextLevelXp - currentLevelXp,
        streak: updatedStreak,
        streakBonus,
      };
    } catch (error) {
      console.error('Error adding XP:', error);
      throw error;
    }
  }

  /**
   * Obtiene las estadísticas de XP del usuario
   */
  async getXpStats(userId: string): Promise<XpStatsResponse> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        xpLogs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!user) {
      throw new Error('Usuario no encontrado');
    }

    const nextLevelXp = this.calculateXpForLevel(user.level + 1);
    const currentLevelXp = this.calculateXpForLevel(user.level);
    const xpForNextLevel = nextLevelXp - currentLevelXp;
    const xpProgressPercentage = Math.round((user.xp / xpForNextLevel) * 100);
    const dataReturn = {
      level: user.level,
      xp: user.xp,
      totalXp: user.totalXp,
      xpForNextLevel,
      xpProgressPercentage,
      streak: user.streak,
      lastStreakDate: user.lastStreakDate,
      recentLogs: user.xpLogs.map((log) => ({
        id: log.id,
        action: log.action,
        xpEarned: log.xpEarned,
        description: log.description,
        date: log.date,
        metadata: log.metadata as Record<string, any>,
        createdAt: log.createdAt,
      })),
    };

    return {
      level: user.level,
      xp: user.xp,
      totalXp: user.totalXp,
      xpForNextLevel,
      xpProgressPercentage,
      streak: user.streak,
      lastStreakDate: user.lastStreakDate,
      recentLogs: user.xpLogs.map((log) => ({
        id: log.id,
        action: log.action,
        xpEarned: log.xpEarned,
        description: log.description,
        date: log.date,
        metadata: log.metadata as Record<string, any>,
        createdAt: log.createdAt,
      })),
    };
  }

  /**
   * Método de conveniencia para agregar XP por completar hábito
   */
  async addHabitXp(
    userId: string,
    habitName: string,
    date?: string,
  ): Promise<LevelUpResponse> {
    return this.addXp(
      userId,
      {
        action: XpAction.HABIT_COMPLETE,
        xpAmount: 10,
        description: `Completaste el hábito: ${habitName}`,
        metadata: { habitName },
      },
      date,
    );
  }

  /**
   * Método de conveniencia para agregar XP por log nutricional
   */
  async addNutritionXp(
    userId: string,
    mealType: string,
    date?: string,
  ): Promise<LevelUpResponse> {
    return this.addXp(
      userId,
      {
        action: XpAction.NUTRITION_LOG,
        xpAmount: 5,
        description: `Registraste tu ${mealType}`,
        metadata: { mealType },
      },
      date,
    );
  }

  /**
   * Método de conveniencia para agregar XP por comentario diario
   */
  async addDailyCommentXp(
    userId: string,
    date?: string,
  ): Promise<LevelUpResponse> {
    return this.addXp(
      userId,
      {
        action: XpAction.DAILY_COMMENT,
        xpAmount: 15,
        description: 'Escribiste una reflexión diaria',
      },
      date,
    );
  }
}
