import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class SavedMealsService {
  constructor(private prisma: PrismaService) {}

  async getAll(userId: string) {
    return this.prisma.savedMeal.findMany({
      where: { userId },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async create(data: {
    name: string;
    description?: string;
    mealType: string;
    foods: any;
    totalCalories: number;
    macronutrients: any;
  }, userId: string) {
    return this.prisma.savedMeal.create({
      data: { ...data, userId },
    });
  }

  async use(id: string, userId: string) {
    const meal = await this.prisma.savedMeal.findFirst({
      where: { id, userId },
    });
    if (!meal) return null;

    await this.prisma.savedMeal.update({
      where: { id },
      data: {
        timesUsed: { increment: 1 },
        lastUsedAt: new Date(),
      },
    });
    return meal;
  }

  async delete(id: string, userId: string) {
    return this.prisma.savedMeal.deleteMany({
      where: { id, userId },
    });
  }

  async update(id: string, data: { name?: string; description?: string }, userId: string) {
    return this.prisma.savedMeal.updateMany({
      where: { id, userId },
      data,
    });
  }
}
