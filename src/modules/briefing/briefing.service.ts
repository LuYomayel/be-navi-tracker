import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { DayScoreService } from '../day-score/day-score.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivitiesService } from '../activities/activities.service';
import { HydrationService } from '../hydration/hydration.service';
import { GoalService } from '../goal/goal.service';
import { EmailService } from './email.service';
import { getLocalDateString } from '../../common/utils/date.utils';

/** Secciones estructuradas del briefing del dia. */
export interface BriefingContent {
  date: string;
  score: { percentage: number; status: string } | null;
  nutrition: {
    consumed: { calories: number; protein: number; carbs: number; fat: number };
    goals: { dailyCalorieGoal: number; proteinGoal: number };
    netCalories: number;
  } | null;
  habits: { name: string; done: boolean }[];
  tasks: { title: string; priority?: string; done: boolean }[];
  hydration: { glasses: number } | null;
  goal: { name?: string; percentage: number; remainingUsd: number } | null;
}

const STATUS_LABEL: Record<string, string> = {
  won: 'ganado',
  partial: 'parcial',
  lost: 'perdido',
  no_data: 'sin datos',
};

@Injectable()
export class BriefingService {
  private readonly logger = new Logger(BriefingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dayScore: DayScoreService,
    private readonly nutrition: NutritionService,
    private readonly tasks: TasksService,
    private readonly activities: ActivitiesService,
    private readonly hydration: HydrationService,
    private readonly goal: GoalService,
    private readonly email: EmailService,
  ) {}

  /** Genera (o regenera) y persiste el briefing del dia. */
  async generate(userId: string, date?: string) {
    const day = date || getLocalDateString();
    const content = await this.aggregate(userId, day);
    const text = this.renderText(content);
    const html = this.renderHtml(content);
    return this.prisma.briefing.upsert({
      where: { userId_date: { userId, date: day } },
      create: { userId, date: day, content: content as any, text, html },
      update: { content: content as any, text, html },
    });
  }

  /** Briefing persistido del dia (o null si todavia no se genero). */
  async getByDate(userId: string, date?: string) {
    const day = date || getLocalDateString();
    return this.prisma.briefing.findUnique({
      where: { userId_date: { userId, date: day } },
    });
  }

  async getRange(userId: string, from: string, to: string) {
    return this.prisma.briefing.findMany({
      where: { userId, date: { gte: from, lte: to } },
      orderBy: { date: 'desc' },
    });
  }

  /** Genera el briefing del dia y lo manda por mail. */
  async generateAndSend(userId: string, date?: string) {
    const briefing = await this.generate(userId, date);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    let emailSent = false;
    if (user?.email) {
      emailSent = await this.email.send({
        to: user.email,
        subject: `🌅 Tu plan de hoy — ${briefing.date}`,
        html: briefing.html,
        text: briefing.text,
      });
      if (emailSent) {
        await this.prisma.briefing.update({
          where: { id: briefing.id },
          data: { emailSent: true, emailSentAt: new Date() },
        });
      }
    }
    return { briefing, emailSent };
  }

  // ── Agregacion ───────────────────────────────────────────────

  private async aggregate(
    userId: string,
    date: string,
  ): Promise<BriefingContent> {
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const dayIndex = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // 0=Lunes

    const [score, balance, todayTasks, allHabits, hydrationLog, goalProgress] =
      await Promise.all([
        this.dayScore.getOrCalculate(userId, date).catch(() => null),
        this.nutrition.getDailyNutritionBalance(userId, date).catch(() => null),
        this.tasks.findAll(userId, { date }).catch(() => [] as any[]),
        this.activities.getAll(userId, false).catch(() => [] as any[]),
        this.hydration.getByDate(userId, date).catch(() => null),
        this.goal.getProgress(userId).catch(() => null),
      ]);

    const habits = (allHabits as any[])
      .filter((h) => {
        const days = typeof h.days === 'string' ? JSON.parse(h.days) : h.days;
        return Array.isArray(days) && days[dayIndex] === true;
      })
      .map((h) => ({
        name: h.name as string,
        done: (h.completions || []).some(
          (c: any) => c.date === date && c.completed,
        ),
      }));

    const tasks = (todayTasks as any[]).map((t) => ({
      title: t.title as string,
      priority: t.priority as string | undefined,
      done: !!t.completed,
    }));

    return {
      date,
      score: score
        ? {
            percentage: (score as any).percentage ?? 0,
            status: (score as any).status ?? 'no_data',
          }
        : null,
      nutrition: balance
        ? {
            consumed: (balance as any).consumed,
            goals: (balance as any).goals,
            netCalories: (balance as any).netCalories,
          }
        : null,
      habits,
      tasks,
      hydration: hydrationLog
        ? { glasses: (hydrationLog as any).glassesConsumed ?? 0 }
        : null,
      goal: goalProgress
        ? {
            name: (goalProgress as any).goal?.name,
            percentage: Math.round((goalProgress as any).percentage ?? 0),
            remainingUsd: (goalProgress as any).remainingUsd ?? 0,
          }
        : null,
    };
  }

  // ── Render texto plano ───────────────────────────────────────

  renderText(c: BriefingContent): string {
    const L: string[] = [];
    L.push(`🌅 Plan de hoy — ${c.date}`);
    if (c.score) {
      L.push(
        `Día: ${c.score.percentage}% (${STATUS_LABEL[c.score.status] || c.score.status})`,
      );
    }

    L.push('', '🎯 Hábitos:');
    if (c.habits.length) {
      for (const h of c.habits) L.push(`  ${h.done ? '✅' : '⬜'} ${h.name}`);
    } else {
      L.push('  (sin hábitos programados hoy)');
    }

    L.push('', '✅ Tareas de hoy:');
    if (c.tasks.length) {
      for (const t of c.tasks) {
        L.push(
          `  ${t.done ? '✅' : '⬜'} ${t.title}${t.priority ? ` (${t.priority})` : ''}`,
        );
      }
    } else {
      L.push('  (sin tareas para hoy)');
    }

    if (c.nutrition) {
      const n = c.nutrition;
      L.push(
        '',
        '🥗 Nutrición:',
        `  ${Math.round(n.consumed.calories)}/${n.goals.dailyCalorieGoal} kcal · proteína ${Math.round(n.consumed.protein)}/${n.goals.proteinGoal}g`,
      );
      const protLeft = Math.max(0, n.goals.proteinGoal - n.consumed.protein);
      if (protLeft > 0) L.push(`  Te faltan ${Math.round(protLeft)}g de proteína.`);
    }

    if (c.hydration) L.push('', `💧 Agua: ${c.hydration.glasses} vasos`);

    if (c.goal) {
      L.push(
        '',
        `🎯 ${c.goal.name || 'Objetivo'}: ${c.goal.percentage}% (faltan USD ${Math.round(c.goal.remainingUsd)})`,
      );
    }

    L.push('', '— NaviTracker');
    return L.join('\n');
  }

  // ── Render HTML (mail) ───────────────────────────────────────

  renderHtml(c: BriefingContent): string {
    const esc = (s: any) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const li = (done: boolean, label: string) =>
      `<li style="margin:4px 0">${done ? '✅' : '⬜'} ${esc(label)}</li>`;

    const habitsHtml = c.habits.length
      ? `<ul style="list-style:none;padding:0;margin:8px 0">${c.habits.map((h) => li(h.done, h.name)).join('')}</ul>`
      : '<p style="color:#94a3b8;margin:8px 0">Sin hábitos programados hoy.</p>';

    const tasksHtml = c.tasks.length
      ? `<ul style="list-style:none;padding:0;margin:8px 0">${c.tasks.map((t) => li(t.done, `${t.title}${t.priority ? ` (${t.priority})` : ''}`)).join('')}</ul>`
      : '<p style="color:#94a3b8;margin:8px 0">Sin tareas para hoy.</p>';

    let nutritionHtml = '';
    if (c.nutrition) {
      const n = c.nutrition;
      const protLeft = Math.max(0, n.goals.proteinGoal - n.consumed.protein);
      nutritionHtml = `
        <h3 style="margin:18px 0 4px">🥗 Nutrición</h3>
        <p style="margin:4px 0">${Math.round(n.consumed.calories)} / ${n.goals.dailyCalorieGoal} kcal · proteína ${Math.round(n.consumed.protein)} / ${n.goals.proteinGoal} g</p>
        ${protLeft > 0 ? `<p style="margin:4px 0;color:#f59e0b">Te faltan ${Math.round(protLeft)} g de proteína.</p>` : ''}`;
    }

    const hydrationHtml = c.hydration
      ? `<h3 style="margin:18px 0 4px">💧 Hidratación</h3><p style="margin:4px 0">${c.hydration.glasses} vasos</p>`
      : '';

    const goalHtml = c.goal
      ? `<h3 style="margin:18px 0 4px">🎯 ${esc(c.goal.name || 'Objetivo')}</h3>
         <p style="margin:4px 0">${c.goal.percentage}% — faltan USD ${Math.round(c.goal.remainingUsd)}</p>`
      : '';

    const scoreBadge = c.score
      ? `<span style="background:#6366f1;color:#fff;border-radius:999px;padding:4px 12px;font-size:14px">Día ${c.score.percentage}% · ${STATUS_LABEL[c.score.status] || c.score.status}</span>`
      : '';

    return `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#0f172a;font-family:system-ui,-apple-system,sans-serif;color:#e2e8f0">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#1e293b;border-radius:16px;padding:24px">
      <h1 style="margin:0 0 4px;font-size:22px">🌅 Tu plan de hoy</h1>
      <p style="margin:0 0 12px;color:#94a3b8">${esc(c.date)}</p>
      ${scoreBadge}
      <h3 style="margin:18px 0 4px">🎯 Hábitos</h3>${habitsHtml}
      <h3 style="margin:18px 0 4px">✅ Tareas de hoy</h3>${tasksHtml}
      ${nutritionHtml}
      ${hydrationHtml}
      ${goalHtml}
      <p style="margin:24px 0 0;color:#64748b;font-size:12px">— NaviTracker</p>
    </div>
  </div>
</body></html>`;
  }
}
