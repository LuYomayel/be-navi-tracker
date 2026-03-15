import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

@Injectable()
export class AICostService {
  constructor(private prisma: PrismaService) {}

  async logCost(data: {
    userId: string;
    service: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
  }) {
    return this.prisma.aICostLog.create({ data });
  }

  async getStats(userId: string) {
    const logs = await this.prisma.aICostLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    const totalCost = logs.reduce((sum, log) => sum + log.costUsd, 0);
    const totalCalls = logs.length;

    // Group by service
    const byService: Record<string, { calls: number; cost: number }> = {};
    for (const log of logs) {
      if (!byService[log.service]) byService[log.service] = { calls: 0, cost: 0 };
      byService[log.service].calls++;
      byService[log.service].cost += log.costUsd;
    }

    // Last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentLogs = logs.filter(l => l.createdAt >= thirtyDaysAgo);
    const monthlyCost = recentLogs.reduce((sum, log) => sum + log.costUsd, 0);

    return {
      totalCost: Number(totalCost.toFixed(4)),
      monthlyCost: Number(monthlyCost.toFixed(4)),
      totalCalls,
      byService,
      recentLogs: logs.slice(0, 20),
    };
  }
}
