import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { Activity, ApiResponse } from '../../common/types';

@Injectable()
export class ActivitiesService {
  private readonly logger = new Logger(ActivitiesService.name);

  constructor(private prisma: PrismaService) {}

  async getAll(userId: string, archived: boolean = false): Promise<Activity[]> {
    try {
      const activities = await this.prisma.activity.findMany({
        where: { user: { id: userId }, archived },
        include: {
          completions: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      return activities.map((activity: any) => ({
        ...activity,
        days: activity.days as boolean[],
      }));
    } catch (error) {
      this.logger.error('Error al obtener actividades', error);
      return [];
    }
  }

  async create(
    data: Omit<Activity, 'id' | 'createdAt' | 'updatedAt' | 'user' | 'userId'>,
    userId: string,
  ): Promise<Activity> {
    try {
      const {
        /* strip relation fields */ user: _u,
        userId: _uid,
        ...cleanData
      } = data as any;

      const activity = await this.prisma.activity.create({
        data: {
          ...cleanData,
          days: cleanData.days,
          userId,
        },
      });

      return {
        ...activity,
        days: activity.days as boolean[],
      };
    } catch (error) {
      this.logger.error('Error al crear actividad', error);
      throw new Error('Error al crear actividad');
    }
  }

  async update(
    id: string,
    data: Partial<Omit<Activity, 'user' | 'userId'>>,
    userId: string,
  ): Promise<Activity | null> {
    try {
      const { user: _u, userId: _uid, ...cleanData } = data as any;

      const activity = await this.prisma.activity.update({
        where: { id, userId },
        data: {
          ...cleanData,
          updatedAt: new Date(),
        },
      });

      return {
        ...activity,
        days: activity.days as boolean[],
      };
    } catch (error) {
      this.logger.error('Error al actualizar actividad', error);
      return null;
    }
  }

  async archive(id: string, userId: string): Promise<Activity | null> {
    try {
      const activity = await this.prisma.activity.update({
        where: { id, userId },
        data: {
          archived: true,
          archivedAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return {
        ...activity,
        days: activity.days as boolean[],
      };
    } catch (error) {
      this.logger.error('Error al archivar actividad', error);
      return null;
    }
  }

  async restore(id: string, userId: string): Promise<Activity | null> {
    try {
      const activity = await this.prisma.activity.update({
        where: { id, userId },
        data: {
          archived: false,
          archivedAt: null,
          updatedAt: new Date(),
        },
      });
      return {
        ...activity,
        days: activity.days as boolean[],
      };
    } catch (error) {
      this.logger.error('Error al restaurar actividad', error);
      return null;
    }
  }

  async delete(id: string, userId: string): Promise<boolean> {
    try {
      await this.prisma.activity.deleteMany({
        where: { id, userId },
      });
      return true;
    } catch (error) {
      this.logger.error('Error al eliminar actividad', error);
      return false;
    }
  }
}
