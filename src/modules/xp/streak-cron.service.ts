import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { StreakService } from './streak.service';
import { getLocalDateString, getLocalHour, toLocalDateString } from '../../common/utils/date.utils';

@Injectable()
export class StreakCronService {
  private readonly logger = new Logger(StreakCronService.name);

  constructor(
    private prisma: PrismaService,
    private streakService: StreakService,
  ) {}

  /**
   * Ejecuta al final del día Argentina (23:59 ART = 02:59 UTC).
   * Cron en UTC: '59 2 * * *'
   */
  @Cron('59 2 * * *') // 23:59 hora Argentina (UTC-3)
  async checkEndOfDayStreaks() {
    this.logger.log('Verificando rachas al final del día (hora Argentina)...');

    try {
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
      });

      const today = getLocalDateString();

      for (const user of users) {
        try {
          await this.streakService.checkEndOfDayStreaks(user.id, today);
          this.logger.log(`Rachas verificadas para usuario ${user.id}`);
        } catch (error) {
          this.logger.error(
            `Error verificando rachas para usuario ${user.id}`,
            error,
          );
        }
      }
      this.logger.log(
        `Verificación de rachas completada - fecha local: ${today}`,
      );
    } catch (error) {
      this.logger.error('Error en verificación de rachas', error);
    }
  }

  /**
   * Ejecuta cada hora para verificar rachas de nutrición (3 comidas).
   * Compara con hora local Argentina.
   */
  @Cron('0 * * * *') // Cada hora en punto
  async checkNutritionStreaks() {
    // Verificar en horas de comida Argentina: 8, 13, 20
    const currentHour = getLocalHour();
    if (![8, 13, 20].includes(currentHour)) {
      return;
    }

    this.logger.log('Verificando rachas de nutrición (hora Argentina)...');

    try {
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
      });

      const today = getLocalDateString();

      for (const user of users) {
        try {
          await this.streakService.updateNutritionStreak(user.id, today);
        } catch (error) {
          this.logger.error(
            `Error verificando racha de nutrición para usuario ${user.id}`,
            error,
          );
        }
      }

      this.logger.log('Verificación de rachas de nutrición completada');
    } catch (error) {
      this.logger.error('Error en verificación de rachas de nutrición', error);
    }
  }

  /**
   * Resetear rachas rotas al inicio del día Argentina (00:01 ART = 03:01 UTC).
   * Cron en UTC: '1 3 * * *'
   */
  @Cron('1 3 * * *') // 00:01 hora Argentina (UTC-3)
  async resetBrokenStreaks() {
    this.logger.log('Verificando rachas rotas (hora Argentina)...');

    try {
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
      });

      // Ayer en hora local Argentina
      const yesterdayDate = new Date();
      yesterdayDate.setDate(yesterdayDate.getDate() - 1);
      const yesterdayStr = toLocalDateString(yesterdayDate);

      for (const user of users) {
        try {
          await this.streakService.updateHabitStreak(user.id, yesterdayStr);
          await this.streakService.updateNutritionStreak(user.id, yesterdayStr);
          await this.streakService.updateActivityStreak(user.id, yesterdayStr);
        } catch (error) {
          this.logger.error(
            `Error reseteando rachas para usuario ${user.id}`,
            error,
          );
        }
      }

      this.logger.log('Verificación de rachas rotas completada');
    } catch (error) {
      this.logger.error('Error en reseteo de rachas', error);
    }
  }
}
