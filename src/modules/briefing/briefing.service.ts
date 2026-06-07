import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../../config/prisma.service';
import { DayScoreService } from '../day-score/day-score.service';
import { NutritionService } from '../nutrition/nutrition.service';
import { TasksService } from '../tasks/tasks.service';
import { ActivitiesService } from '../activities/activities.service';
import { HydrationService } from '../hydration/hydration.service';
import { GoalService } from '../goal/goal.service';
import { CalendarService } from '../calendar/calendar.service';
import { TrelloService } from '../trello/trello.service';
import { AICostService } from '../ai-cost/ai-cost.service';
import { EmailService } from './email.service';
import { getLocalDateString } from '../../common/utils/date.utils';

/** Secciones estructuradas del briefing del dia. */
export interface BriefingContent {
  date: string;
  narrative: string | null;
  score: { percentage: number; status: string } | null;
  calendar: { title: string; time: string; location?: string | null }[];
  tickets: string | null;
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
  private openai: OpenAI | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dayScore: DayScoreService,
    private readonly nutrition: NutritionService,
    private readonly tasks: TasksService,
    private readonly activities: ActivitiesService,
    private readonly hydration: HydrationService,
    private readonly goal: GoalService,
    private readonly calendar: CalendarService,
    private readonly trello: TrelloService,
    private readonly aiCost: AICostService,
    private readonly email: EmailService,
  ) {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  /** Genera (o regenera) y persiste el briefing del dia. */
  async generate(userId: string, date?: string) {
    const day = date || getLocalDateString();
    const content = await this.aggregate(userId, day);
    content.narrative = await this.composeNarrative(userId, content);
    const text = this.renderText(content);
    const html = this.renderHtml(content);
    return this.prisma.briefing.upsert({
      where: { userId_date: { userId, date: day } },
      create: { userId, date: day, content: content as any, text, html },
      update: { content: content as any, text, html },
    });
  }

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

    const [
      score,
      balance,
      todayTasks,
      allHabits,
      hydrationLog,
      goalProgress,
      calEvents,
      tickets,
    ] = await Promise.all([
      this.dayScore.getOrCalculate(userId, date).catch(() => null),
      this.nutrition.getDailyNutritionBalance(userId, date).catch(() => null),
      this.tasks.findAll(userId, { date }).catch(() => [] as any[]),
      this.activities.getAll(userId, false).catch(() => [] as any[]),
      this.hydration.getByDate(userId, date).catch(() => null),
      this.goal.getProgress(userId).catch(() => null),
      this.calendar.getEvents(userId, date, date).catch(() => [] as any[]),
      this.trello.getTicketsSummary().catch(() => null),
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

    const calendar = (calEvents as any[]).map((e) => ({
      title: e.title as string,
      time: e.allDay
        ? 'todo el día'
        : new Date(e.startTime).toLocaleTimeString('es-AR', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'America/Argentina/Buenos_Aires',
          }),
      location: (e.location as string) || null,
    }));

    return {
      date,
      narrative: null,
      score: score
        ? {
            percentage: (score as any).percentage ?? 0,
            status: (score as any).status ?? 'no_data',
          }
        : null,
      calendar,
      tickets: tickets && (tickets as string).trim() ? (tickets as string) : null,
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

  // ── Narrativa con IA ─────────────────────────────────────────

  private async composeNarrative(
    userId: string,
    content: BriefingContent,
  ): Promise<string | null> {
    if (!this.openai) return null;
    try {
      const datos = this.renderStructured(content);
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'Sos el asistente personal de Luciano. Escribí un briefing matutino cálido y breve (2 a 4 frases) en español rioplatense informal, arrancando con un saludo tipo "☀️ Buen día". Resumí lo importante del día y marcá UN foco principal. Sé motivador y concreto, sin repetir listas largas. No inventes nada que no esté en los datos.',
          },
          { role: 'user', content: `Datos del día:\n${datos}` },
        ],
        temperature: 0.6,
        max_tokens: 220,
      });
      const text = completion.choices?.[0]?.message?.content?.trim() || null;
      if (completion?.usage) {
        await this.aiCost
          .logFromCompletion(userId, 'briefing-narrative', completion)
          .catch(() => undefined);
      }
      return text;
    } catch (e) {
      this.logger.warn(`Narrativa IA fallo: ${(e as Error).message}`);
      return null;
    }
  }

  // ── Render ───────────────────────────────────────────────────

  renderText(c: BriefingContent): string {
    const L: string[] = [];
    if (c.narrative) {
      L.push(c.narrative, '');
    }
    L.push(`🌅 Plan de hoy — ${c.date}`);
    L.push(this.renderStructured(c));
    L.push('', '— NaviTracker');
    return L.join('\n');
  }

  /** Las secciones de datos en texto plano (sin la narrativa). */
  private renderStructured(c: BriefingContent): string {
    const L: string[] = [];
    if (c.score) {
      L.push(
        `Día: ${c.score.percentage}% (${STATUS_LABEL[c.score.status] || c.score.status})`,
      );
    }

    L.push('', '🗓️ Agenda:');
    if (c.calendar.length) {
      for (const e of c.calendar)
        L.push(`  ${e.time} · ${e.title}${e.location ? ` (${e.location})` : ''}`);
    } else {
      L.push('  (sin eventos hoy)');
    }

    if (c.tickets) {
      L.push('', '💼 Trabajo (Trello):', ...c.tickets.split('\n').map((x) => `  ${x}`));
    }

    L.push('', '🎯 Hábitos:');
    if (c.habits.length) {
      for (const h of c.habits) L.push(`  ${h.done ? '✅' : '⬜'} ${h.name}`);
    } else {
      L.push('  (sin hábitos programados hoy)');
    }

    L.push('', '✅ Tareas de hoy:');
    if (c.tasks.length) {
      for (const t of c.tasks)
        L.push(
          `  ${t.done ? '✅' : '⬜'} ${t.title}${t.priority ? ` (${t.priority})` : ''}`,
        );
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

    return L.join('\n');
  }

  renderHtml(c: BriefingContent): string {
    const esc = (s: any) =>
      String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const li = (done: boolean, label: string) =>
      `<li style="margin:4px 0">${done ? '✅' : '⬜'} ${esc(label)}</li>`;

    const narrativeHtml = c.narrative
      ? `<p style="margin:0 0 16px;font-size:15px;line-height:1.5;color:#cbd5e1">${esc(c.narrative)}</p>`
      : '';

    const calendarHtml = c.calendar.length
      ? `<ul style="list-style:none;padding:0;margin:8px 0">${c.calendar
          .map(
            (e) =>
              `<li style="margin:4px 0"><b>${esc(e.time)}</b> · ${esc(e.title)}${e.location ? ` <span style="color:#94a3b8">(${esc(e.location)})</span>` : ''}</li>`,
          )
          .join('')}</ul>`
      : '<p style="color:#94a3b8;margin:8px 0">Sin eventos hoy.</p>';

    const ticketsHtml = c.tickets
      ? `<pre style="white-space:pre-wrap;font-family:inherit;font-size:13px;margin:8px 0;color:#e2e8f0">${esc(c.tickets)}</pre>`
      : '';

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

    const ticketsSection = c.tickets
      ? `<h3 style="margin:18px 0 4px">💼 Trabajo (Trello)</h3>${ticketsHtml}`
      : '';

    return `<!DOCTYPE html><html lang="es"><body style="margin:0;background:#0f172a;font-family:system-ui,-apple-system,sans-serif;color:#e2e8f0">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#1e293b;border-radius:16px;padding:24px">
      <h1 style="margin:0 0 4px;font-size:22px">🌅 Tu plan de hoy</h1>
      <p style="margin:0 0 12px;color:#94a3b8">${esc(c.date)}</p>
      ${narrativeHtml}
      ${scoreBadge}
      <h3 style="margin:18px 0 4px">🗓️ Agenda</h3>${calendarHtml}
      ${ticketsSection}
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
