import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { StreakService } from './streak.service';

@Injectable()
export class StreakCronService {
  private readonly logger = new Logger(StreakCronService.name);

  constructor(
    private prisma: PrismaService,
    private streakService: StreakService,
  ) {}

  /**
   * Ejecuta al final del día (23:59) para verificar rachas
   */
  @Cron('59 23 * * *') // 23:59 todos los días
  async checkEndOfDayStreaks() {
    this.logger.log('Verificando rachas al final del día...');

    try {
      // Obtener todos los usuarios activos
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
      });

      const today = new Date().toISOString().split('T')[0];

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
      const newDate = new Date();
      this.logger.log(
        `Verificación de rachas completada - date: ${newDate.toISOString()}, hours: ${newDate.getHours()}, minutes: ${newDate.getMinutes()}`,
      );
    } catch (error) {
      this.logger.error('Error en verificación de rachas', error);
    }
  }

  /**
   * Ejecuta cada hora para verificar rachas de nutrición (3 comidas)
   */
  @Cron(CronExpression.EVERY_HOUR)
  async checkNutritionStreaks() {
    // Solo verificar en horas de comida (8, 13, 20)
    const currentHour = new Date().getHours();
    if (![8, 13, 20].includes(currentHour)) {
      return;
    }

    this.logger.log('Verificando rachas de nutrición...');

    try {
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
      });

      const today = new Date().toISOString().split('T')[0];

      for (const user of users) {
        try {
          // Solo actualizar racha de nutrición si se completaron 3 comidas
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
   * Resetear rachas rotas al inicio del día (00:01)
   */
  @Cron('1 0 * * *') // 00:01 todos los días
  async resetBrokenStreaks() {
    this.logger.log('Verificando rachas rotas...');

    try {
      const users = await this.prisma.user.findMany({
        where: { isActive: true },
      });

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];

      for (const user of users) {
        try {
          // Actualizar/Resetear racha de hábitos según el día de ayer
          await this.streakService.updateHabitStreak(user.id, yesterdayStr);

          // Actualizar/Resetear racha de nutrición para el día de ayer
          await this.streakService.updateNutritionStreak(user.id, yesterdayStr);

          // Opcional: actividad física
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
