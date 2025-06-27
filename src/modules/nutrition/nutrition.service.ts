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
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { id: _id, ...payload } = data as any;
      const prismaData: any = {
        ...payload,
        userId: payload.userId ?? 'default',
        foods: JSON.parse(JSON.stringify(payload.foods)),
        macronutrients: JSON.parse(JSON.stringify(payload.macronutrients)),
        userAdjustments: payload.userAdjustments
          ? JSON.parse(JSON.stringify(payload.userAdjustments))
          : undefined,
      };

      const created = await this.prisma.nutritionAnalysis.create({
        data: prismaData,
      });
      // Reconstituir tipos
      const analysis: NutritionAnalysis = {
        ...created,
        foods: payload.foods,
        macronutrients: payload.macronutrients,
        userAdjustments: payload.userAdjustments,
      };
      return analysis;
    } catch (error) {
      console.error('Error creating nutrition analysis:', error);
      throw new Error('Failed to create nutrition analysis');
    }
  }

  async update(
    id: string,
    data: NutritionAnalysis,
  ): Promise<NutritionAnalysis> {
    try {
      const updated = await this.prisma.nutritionAnalysis.update({
        where: { id },
        data: {
          ...data,
          foods: JSON.parse(JSON.stringify(data.foods)),
          macronutrients: JSON.parse(JSON.stringify(data.macronutrients)),
          userAdjustments: data.userAdjustments
            ? JSON.parse(JSON.stringify(data.userAdjustments))
            : undefined,
        },
      });
      const analysis: NutritionAnalysis = {
        ...updated,
        foods: data.foods,
        macronutrients: data.macronutrients,
        userAdjustments: data.userAdjustments,
      };
      return analysis;
    } catch (error) {
      console.error('Error updating nutrition analysis:', error);
      throw new Error('Failed to update nutrition analysis');
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
