import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';
import { XpAction } from '../xp/dto/xp.dto';

@Injectable()
export class DayScoreService {
  constructor(
    private prisma: PrismaService,
    private xpService: XpService,
  ) {}

  async calculate(userId: string, date: string) {
    // 1. HABITS: scheduled for this day vs completed
    const dayOfWeek = new Date(date + 'T12:00:00').getDay(); // 0=Sun
    const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 0=Mon

    const activities = await this.prisma.activity.findMany({
      where: {
        userId,
        archived: false,
        createdAt: { lte: new Date(date + 'T23:59:59') },
      },
      include: {
        completions: {
          where: { date },
        },
      },
    });

    const scheduledActivities = activities.filter((a) => {
      const days =
        typeof a.days === 'string' ? JSON.parse(a.days as string) : a.days;
      return Array.isArray(days) && days[dayIndex] === true;
    });

    const habitsTotal = scheduledActivities.length;
    const habitsCompleted = scheduledActivities.filter((a) =>
      a.completions.some((c) => c.completed),
    ).length;

    // 2. TASKS: due this day
    const tasks = await this.prisma.task.findMany({
      where: { userId, dueDate: date },
    });
    const tasksTotal = tasks.length;
    const tasksCompleted = tasks.filter((t) => t.completed).length;

    // 3. NUTRITION: at least one meal logged
    const nutritionCount = await this.prisma.nutritionAnalysis.count({
      where: { userId, date },
    });
    const nutritionLogged = nutritionCount > 0;

    // 4. EXERCISE: at least one physical activity
    const exerciseCount = await this.prisma.physicalActivity.count({
      where: { userId, date },
    });
    const exerciseLogged = exerciseCount > 0;

    // 5. REFLECTION: at least one note
    const noteCount = await this.prisma.note.count({
      where: { userId, date },
    });
    const reflectionLogged = noteCount > 0;

    // Calculate score
    let totalItems = habitsTotal + tasksTotal;
    let completedItems = habitsCompleted + tasksCompleted;

    // Boolean modules always count as 1 item each
    totalItems += 3; // nutrition + exercise + reflection
    if (nutritionLogged) completedItems += 1;
    if (exerciseLogged) completedItems += 1;
    if (reflectionLogged) completedItems += 1;

    const percentage =
      totalItems > 0
        ? Math.round((completedItems / totalItems) * 100)
        : 0;

    let status: string;
    if (totalItems === 0) status = 'no_data';
    else if (percentage === 100) status = 'won';
    else if (percentage >= 50) status = 'partial';
    else status = 'lost';

    // Upsert to DB
    const dayScore = await this.prisma.dayScore.upsert({
      where: {
        userId_date: { userId, date },
      },
      create: {
        userId,
        date,
        totalItems,
        completedItems,
        percentage,
        status,
        habitsTotal,
        habitsCompleted,
        tasksTotal,
        tasksCompleted,
        nutritionLogged,
        exerciseLogged,
        reflectionLogged,
      },
      update: {
        totalItems,
        completedItems,
        percentage,
        status,
        habitsTotal,
        habitsCompleted,
        tasksTotal,
        tasksCompleted,
        nutritionLogged,
        exerciseLogged,
        reflectionLogged,
      },
    });

    // Award XP (deduplicate: only if no XP log exists for this date+action)
    if (status === 'won' || (status === 'partial' && percentage >= 75)) {
      const action =
        status === 'won' ? XpAction.DAY_WON : XpAction.DAY_PARTIAL;
      const xpAmount = status === 'won' ? 25 : 15;

      const existingXpLog = await this.prisma.xpLog.findFirst({
        where: {
          userId,
          date,
          action: action as string,
        },
      });

      if (!existingXpLog) {
        await this.xpService.addXp(userId, {
          action,
          xpAmount,
          description:
            status === 'won'
              ? `Dia ganado: ${date}`
              : `Dia parcial (${percentage}%): ${date}`,
          metadata: { date, percentage },
        });
      }
    }

    return dayScore;
  }

  async getOrCalculate(userId: string, date: string) {
    const today = new Date().toISOString().split('T')[0];

    // Always recalculate today (data may have changed)
    if (date === today) {
      return await this.calculate(userId, date);
    }

    // For past days, use cache
    const cached = await this.prisma.dayScore.findUnique({
      where: { userId_date: { userId, date } },
    });

    if (cached) return cached;

    // No cache, calculate
    return await this.calculate(userId, date);
  }

  async getRange(userId: string, from: string, to: string) {
    const today = new Date().toISOString().split('T')[0];
    const allDates = this.generateDateRange(from, to);

    // Fetch all existing scores in one query
    const scores = await this.prisma.dayScore.findMany({
      where: {
        userId,
        date: { gte: from, lte: to },
      },
      orderBy: { date: 'asc' },
    });
    const scoreMap = new Map(scores.map((s) => [s.date, s]));

    const result: any[] = [];

    for (const date of allDates) {
      if (date > today) {
        result.push({
          date,
          status: 'future',
          percentage: 0,
          totalItems: 0,
          completedItems: 0,
          habitsTotal: 0,
          habitsCompleted: 0,
          tasksTotal: 0,
          tasksCompleted: 0,
          nutritionLogged: false,
          exerciseLogged: false,
          reflectionLogged: false,
        });
      } else if (date === today) {
        // Always recalculate today
        const score = await this.calculate(userId, date);
        result.push(score);
      } else if (scoreMap.has(date)) {
        result.push(scoreMap.get(date));
      } else {
        // Calculate and cache past days without score
        const score = await this.calculate(userId, date);
        result.push(score);
      }
    }

    return result;
  }

  async getMonthlyStats(userId: string, month: string) {
    const [year, m] = month.split('-').map(Number);
    const lastDay = new Date(year, m, 0).getDate();
    const from = `${month}-01`;
    const to = `${month}-${String(lastDay).padStart(2, '0')}`;

    const scores = await this.prisma.dayScore.findMany({
      where: { userId, date: { gte: from, lte: to } },
    });

    const won = scores.filter((s) => s.status === 'won').length;
    const partial = scores.filter((s) => s.status === 'partial').length;
    const lost = scores.filter((s) => s.status === 'lost').length;
    const avgPercentage =
      scores.length > 0
        ? Math.round(
            scores.reduce((sum, s) => sum + s.percentage, 0) /
              scores.length,
          )
        : 0;

    const bestDay = scores.reduce(
      (best, s) => (s.percentage > (best?.percentage ?? -1) ? s : best),
      null as any,
    );
    const worstDay = scores.reduce(
      (worst, s) =>
        s.percentage < (worst?.percentage ?? 101) ? s : worst,
      null as any,
    );

    return {
      month,
      totalDays: scores.length,
      won,
      partial,
      lost,
      avgPercentage,
      bestDay,
      worstDay,
    };
  }

  async getWinStreak(userId: string) {
    const today = new Date().toISOString().split('T')[0];
    const scores = await this.prisma.dayScore.findMany({
      where: { userId, date: { lte: today } },
      orderBy: { date: 'desc' },
      take: 365,
    });

    // Current streak (consecutive won days from today backwards)
    let currentStreak = 0;
    let expectedDate = today;
    for (const score of scores) {
      if (score.date !== expectedDate) break; // Gap in dates
      if (score.status === 'won') {
        currentStreak++;
        const d = new Date(expectedDate + 'T12:00:00');
        d.setDate(d.getDate() - 1);
        expectedDate = d.toISOString().split('T')[0];
      } else {
        break;
      }
    }

    // Best historical streak (must also check consecutive dates)
    let bestStreak = 0;
    let tempStreak = 0;
    let prevDate: string | null = null;
    const chronological = [...scores].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    for (const score of chronological) {
      if (score.status === 'won') {
        // Check if this date is consecutive to previous
        if (prevDate) {
          const prev = new Date(prevDate + 'T12:00:00');
          prev.setDate(prev.getDate() + 1);
          const expectedNext = prev.toISOString().split('T')[0];
          if (score.date !== expectedNext) {
            tempStreak = 0; // Reset - gap in dates
          }
        }
        tempStreak++;
        bestStreak = Math.max(bestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
      prevDate = score.date;
    }

    return {
      currentStreak,
      bestStreak,
      lastWonDate: scores.find((s) => s.status === 'won')?.date,
    };
  }

  private generateDateRange(from: string, to: string): string[] {
    const dates: string[] = [];
    const current = new Date(from + 'T12:00:00');
    const end = new Date(to + 'T12:00:00');

    while (current <= end) {
      dates.push(current.toISOString().split('T')[0]);
      current.setDate(current.getDate() + 1);
    }
    return dates;
  }
}
