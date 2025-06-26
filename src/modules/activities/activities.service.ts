import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { Activity, ApiResponse } from '../../common/types';

@Injectable()
export class ActivitiesService {
  constructor(private prisma: PrismaService) {}

  async getAll(): Promise<Activity[]> {
    try {
      const activities = await this.prisma.activity.findMany({
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
    data: Omit<Activity, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<Activity> {
    try {
      const activity = await this.prisma.activity.create({
        data: {
          ...data,
          days: data.days,
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

  async update(id: string, data: Partial<Activity>): Promise<Activity | null> {
    try {
      const activity = await this.prisma.activity.update({
        where: { id },
        data: {
          ...data,
          updatedAt: new Date(),
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
