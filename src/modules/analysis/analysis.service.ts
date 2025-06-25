import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateAnalysisDto } from './dto/analysis.dto';

@Injectable()
export class AnalysisService {
  constructor(private prisma: PrismaService) {}

  async getRecentAnalyses(userId: string, days: number = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    const startDateString = startDate.toISOString().split('T')[0];

    try {
      const analyses = await this.prisma.analysis.findMany({
        where: {
          userId,
          date: {
            gte: startDateString,
          },
        },
        orderBy: {
          date: 'desc',
        },
      });

      return analyses.map((analysis) => ({
        id: analysis.id,
        date: analysis.date,
        detectedPatterns: analysis.detectedPatterns as string[],
        mood: analysis.mood,
        createdAt: analysis.createdAt,
      }));
    } catch (error) {
      console.error('Error fetching recent analyses:', error);
      throw new Error('Failed to fetch recent analyses');
    }
  }

  async createAnalysis(userId: string, data: CreateAnalysisDto) {
    try {
      const analysis = await this.prisma.analysis.create({
        data: {
          userId,
          date: data.date,
          detectedPatterns: data.detectedPatterns,
          mood: data.mood,
          notes: data.notes,
        },
      });

      return {
        id: analysis.id,
        date: analysis.date,
        detectedPatterns: analysis.detectedPatterns as string[],
        mood: analysis.mood,
        notes: analysis.notes,
        createdAt: analysis.createdAt,
      };
    } catch (error) {
      console.error('Error creating analysis:', error);
      throw new Error('Failed to create analysis');
    }
  }
}
