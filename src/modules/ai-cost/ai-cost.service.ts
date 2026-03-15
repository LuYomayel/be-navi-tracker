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

  /**
   * Calculates cost and logs it in a single call.
   * GPT-4o pricing: $2.50/1M input, $10.00/1M output
   */
  async logFromCompletion(
    userId: string,
    service: string,
    completion: { usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } },
    model: string = 'gpt-4o',
  ) {
    const usage = completion.usage;
    if (!usage) return;

    const costUsd = this.calculateCost(usage.prompt_tokens, usage.completion_tokens, model);

    try {
      await this.logCost({
        userId,
        service,
        model,
        promptTokens: usage.prompt_tokens,
        completionTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens,
        costUsd,
      });
    } catch (error) {
      // Never fail the parent operation because of cost logging
      console.error('Error logging AI cost:', error);
    }
  }

  /**
   * Calculate cost in USD based on model pricing.
   * GPT-4o: $2.50/1M input, $10.00/1M output
   * GPT-4o-mini: $0.15/1M input, $0.60/1M output
   */
  calculateCost(promptTokens: number, completionTokens: number, model: string = 'gpt-4o'): number {
    const pricing: Record<string, { input: number; output: number }> = {
      'gpt-4o': { input: 2.5 / 1_000_000, output: 10.0 / 1_000_000 },
      'gpt-4o-mini': { input: 0.15 / 1_000_000, output: 0.60 / 1_000_000 },
      'gpt-4-turbo': { input: 10.0 / 1_000_000, output: 30.0 / 1_000_000 },
    };
    const rates = pricing[model] || pricing['gpt-4o'];
    return Number(((promptTokens * rates.input) + (completionTokens * rates.output)).toFixed(6));
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
