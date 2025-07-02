import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { Activity, ApiResponse } from '../../common/types';

@Injectable()
export class ActivitiesService {
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
      console.error('Error fetching activities:', error);
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
      console.error('Error creating activity:', error);
      throw new Error('Failed to create activity');
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
        where: { id },
        data: {
          ...cleanData,
          updatedAt: new Date(),
          userId,
        },
      });

      return {
        ...activity,
        days: activity.days as boolean[],
      };
    } catch (error) {
      console.error('Error updating activity:', error);
      return null;
    }
  }

  async archive(id: string, userId: string): Promise<Activity | null> {
    try {
      const activity = await this.prisma.activity.update({
        where: { id },
        data: {
          archived: true,
          updatedAt: new Date(),
          userId,
        },
      });
      return {
        ...activity,
        days: activity.days as boolean[],
      };
    } catch (error) {
      console.error('Error archiving activity:', error);
      return null;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.activity.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      console.error('Error deleting activity:', error);
      return false;
    }
  }
}
