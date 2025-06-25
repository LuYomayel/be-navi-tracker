import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { NutritionAnalysis } from '../../common/types';

@Injectable()
export class NutritionService {
  constructor(private prisma: PrismaService) {}

  async getAll(): Promise<NutritionAnalysis[]> {
    try {
      const analyses = await this.prisma.nutritionAnalysis.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return analyses as any[];
    } catch (error) {
      console.error('Error fetching nutrition analyses:', error);
      return [];
    }
  }

  async getByDate(date: string): Promise<NutritionAnalysis[]> {
    try {
      const analyses = await this.prisma.nutritionAnalysis.findMany({
        where: { date },
        orderBy: { createdAt: 'desc' },
      });
      return analyses as any[];
    } catch (error) {
      console.error('Error fetching nutrition analyses by date:', error);
      return [];
    }
  }

  async create(
    data: Omit<NutritionAnalysis, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<NutritionAnalysis> {
    try {
      const analysis = await this.prisma.nutritionAnalysis.create({
        data: {
          ...data,
          foods: data.foods as any,
          macronutrients: data.macronutrients as any,
          userAdjustments: data.userAdjustments as any,
        },
      });
      return analysis as any;
    } catch (error) {
      console.error('Error creating nutrition analysis:', error);
      throw new Error('Failed to create nutrition analysis');
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await this.prisma.nutritionAnalysis.delete({
        where: { id },
      });
      return true;
    } catch (error) {
      console.error('Error deleting nutrition analysis:', error);
      return false;
    }
  }
}
