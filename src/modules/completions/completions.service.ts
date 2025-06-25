import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../config/prisma.service";
import { DailyCompletion } from "../../common/types";

@Injectable()
export class CompletionsService {
  constructor(private prisma: PrismaService) {}

  async getAll(): Promise<DailyCompletion[]> {
    try {
      return await this.prisma.dailyCompletion.findMany({
        orderBy: { date: "desc" },
      });
    } catch (error) {
      console.error("Error fetching completions:", error);
      return [];
    }
  }

  async toggle(activityId: string, date: string): Promise<DailyCompletion> {
    try {
      const existing = await this.prisma.dailyCompletion.findUnique({
        where: {
          activityId_date: {
            activityId,
            date,
          },
        },
      });

      if (existing) {
        const updated = await this.prisma.dailyCompletion.update({
          where: { id: existing.id },
          data: { completed: !existing.completed },
        });
        return updated;
      } else {
        const created = await this.prisma.dailyCompletion.create({
          data: {
            activityId,
            date,
            completed: true,
          },
        });
        return created;
      }
    } catch (error) {
      console.error("Error toggling completion:", error);
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
    endDate: string
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
      console.error("Error fetching activity completions:", error);
      return [];
    }
  }
}
