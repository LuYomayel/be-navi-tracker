import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { DailyCompletion } from '../../common/types';
import { XpService } from '../xp/xp.service';

@Injectable()
export class CompletionsService {
  constructor(
    private prisma: PrismaService,
    private xpService: XpService,
  ) {}

  async getAll(): Promise<DailyCompletion[]> {
    try {
      return await this.prisma.dailyCompletion.findMany({
        orderBy: { date: 'desc' },
      });
    } catch (error) {
      console.error('Error fetching completions:', error);
      return [];
    }
  }

  async toggle(
    activityId: string,
    date: string,
    userId: string = 'default',
  ): Promise<DailyCompletion> {
    try {
      const existing = await this.prisma.dailyCompletion.findUnique({
        where: {
          activityId_date: {
            activityId,
            date,
          },
        },
      });

      let completion: DailyCompletion;

      if (existing) {
        completion = await this.prisma.dailyCompletion.update({
          where: { id: existing.id },
          data: { completed: !existing.completed },
        });
      } else {
        completion = await this.prisma.dailyCompletion.create({
          data: {
            activityId,
            date,
            completed: true,
          },
        });
      }

      // 🎮 Si el hábito se completó (no se descompletó), agregar XP
      if (completion.completed) {
        try {
          // Obtener el nombre de la actividad para el log de XP
          const activity = await this.prisma.activity.findUnique({
            where: { id: activityId },
            select: { name: true },
          });

          const habitName = activity?.name || 'Hábito';

          // Agregar XP por completar hábito
          await this.xpService.addHabitXp(userId, habitName, date);
          console.log(`✨ XP agregada por completar hábito: ${habitName}`);
        } catch (xpError) {
          console.error('❌ Error agregando XP:', xpError);
          // No fallar la completación si hay error con XP
        }
      }

      return completion;
    } catch (error) {
      console.error('Error toggling completion:', error);
      // Fallback
      const fallbackId = `${activityId}-${date}-${Date.now()}`;
      return {
        id: fallbackId,
        activityId,
        date,
        completed: true,
        notes: undefined,
        createdAt: new Date(),
      };
    }
  }

  async getForActivity(
    activityId: string,
    startDate: string,
    endDate: string,
  ): Promise<DailyCompletion[]> {
    try {
      return await this.prisma.dailyCompletion.findMany({
        where: {
          activityId,
          date: {
            gte: startDate,
            lte: endDate,
          },
        },
      });
    } catch (error) {
      console.error('Error fetching activity completions:', error);
      return [];
    }
  }
}
