import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';
import { XpAction } from '../xp/dto/xp.dto';
import { getLocalDateString } from '../../common/utils/date.utils';

export interface SleepDto {
  date: string; // YYYY-MM-DD del día en que se despertó
  minutesAsleep: number;
  bedTime?: string | null;
  wakeTime?: string | null;
  quality?: number | null;
  deepMinutes?: number | null;
  remMinutes?: number | null;
  awakeMinutes?: number | null;
  heartRateAvg?: number | null;
  source?: string;
  notes?: string | null;
}

const MIN_MINUTES = 30;
const MAX_MINUTES = 20 * 60;

/** "7h 30m" a partir de minutos. */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

/**
 * Normaliza a minutos lo que puede mandar el atajo de iOS, que según cómo se
 * arme el shortcut manda number, "7:45", "7h 45m" o horas decimales "7,75".
 */
export function parseDuration(
  value: number | string | undefined | null,
): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (!value) return null;
  const raw = value.trim().toLowerCase().replace(',', '.');
  if (!raw) return null;

  // "7:45"
  const colon = raw.match(/^(\d+):([0-5]?\d)$/);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);

  // "7h 45m" | "7h" | "45m"
  const hm = raw.match(/^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+)\s*m)?$/);
  if (hm && (hm[1] || hm[2])) {
    return Math.round(Number(hm[1] || 0) * 60 + Number(hm[2] || 0));
  }

  // Número pelado: chico = horas ("8"), grande = minutos ("465")
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num <= 20 ? Math.round(num * 60) : Math.round(num);
}

/**
 * Saca "HH:mm" de lo que mande el atajo: ya sea "23:15", la fecha entera de
 * la muestra de Health ("2026-08-06T07:03:00-03:00", "6 ago 2026 23:12") o
 * con AM/PM ("11:30 p. m.").
 */
export function parseClock(value?: string | null): string | null {
  if (!value) return null;
  const raw = String(value).trim().toLowerCase();
  if (!raw) return null;

  const pad = (n: number) => String(n).padStart(2, '0');

  // Primer HH:mm que aparezca, con AM/PM opcional detrás
  const m = raw.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/);
  if (!m) return null;
  let hour = Number(m[1]);
  const min = Number(m[2]);
  if (hour > 23 || min > 59) return null;
  const meridiem = m[3]?.replace(/[.\s]/g, '');
  if (meridiem === 'pm' && hour < 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return `${pad(hour)}:${pad(min)}`;
}

/** Minutos entre dos horarios, cruzando la medianoche. */
export function minutesBetween(
  from?: string | null,
  to?: string | null,
): number | null {
  const a = parseClock(from);
  const b = parseClock(to);
  if (!a || !b) return null;
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  let diff = bh * 60 + bm - (ah * 60 + am);
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

@Injectable()
export class SleepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xp: XpService,
  ) {}

  /**
   * Guarda (o pisa) el sueño de una noche. Es upsert por día para que el
   * atajo de la mañana se pueda correr dos veces sin duplicar.
   */
  async upsertSleep(userId: string, dto: SleepDto) {
    const date = dto.date || getLocalDateString();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException('Fecha inválida (YYYY-MM-DD)');
    }
    const minutes = Math.round(dto.minutesAsleep);
    if (!minutes || minutes < MIN_MINUTES || minutes > MAX_MINUTES) {
      throw new BadRequestException(
        `Duración inválida: tiene que estar entre ${MIN_MINUTES} minutos y ${MAX_MINUTES / 60} horas`,
      );
    }
    const quality =
      dto.quality == null
        ? null
        : Math.max(1, Math.min(5, Math.round(dto.quality)));

    const previo = await this.prisma.sleepLog.findUnique({
      where: { userId_date: { userId, date } },
    });

    const data = {
      minutesAsleep: minutes,
      bedTime: dto.bedTime || null,
      wakeTime: dto.wakeTime || null,
      quality,
      deepMinutes: dto.deepMinutes ?? null,
      remMinutes: dto.remMinutes ?? null,
      awakeMinutes: dto.awakeMinutes ?? null,
      heartRateAvg: dto.heartRateAvg ?? null,
      source: dto.source || 'manual',
      notes: dto.notes || null,
    };

    const log = await this.prisma.sleepLog.upsert({
      where: { userId_date: { userId, date } },
      create: { userId, date, ...data },
      update: data,
    });

    // XP una sola vez por noche (correr el atajo de nuevo no da XP extra)
    if (!previo) {
      await this.xp
        .addXp(
          userId,
          {
            action: XpAction.SLEEP_LOG,
            xpAmount: 10,
            description: `Sueño registrado: ${formatDuration(minutes)}`,
          },
          date,
        )
        .catch(() => undefined);
    }

    return log;
  }

  async getByDate(userId: string, date: string) {
    return this.prisma.sleepLog.findUnique({
      where: { userId_date: { userId, date } },
    });
  }

  async getRange(userId: string, from: string, to: string) {
    return this.prisma.sleepLog.findMany({
      where: { userId, date: { gte: from, lte: to } },
      orderBy: { date: 'desc' },
    });
  }

  async delete(userId: string, date: string) {
    const log = await this.prisma.sleepLog.findUnique({
      where: { userId_date: { userId, date } },
    });
    if (!log) throw new NotFoundException('No hay sueño registrado ese día');
    await this.prisma.sleepLog.delete({ where: { id: log.id } });
    return { deleted: true };
  }

  /** Promedios de las últimas N noches + mejor y peor. */
  async getStats(userId: string, days = 7) {
    const logs = await this.prisma.sleepLog.findMany({
      where: { userId },
      orderBy: { date: 'desc' },
      take: days,
    });

    if (logs.length === 0) {
      return {
        noches: 0,
        promedioMinutos: 0,
        promedioTexto: '—',
        calidadPromedio: null as number | null,
        mejorNoche: null as (typeof logs)[number] | null,
        peorNoche: null as (typeof logs)[number] | null,
        logs,
      };
    }

    const total = logs.reduce((a, l) => a + l.minutesAsleep, 0);
    const promedioMinutos = Math.round(total / logs.length);
    const conCalidad = logs.filter((l) => l.quality != null);
    const ordenados = [...logs].sort((a, b) => a.minutesAsleep - b.minutesAsleep);

    return {
      noches: logs.length,
      promedioMinutos,
      promedioTexto: formatDuration(promedioMinutos),
      calidadPromedio: conCalidad.length
        ? Math.round(
            conCalidad.reduce((a, l) => a + (l.quality as number), 0) /
              conCalidad.length,
          )
        : null,
      mejorNoche: ordenados[ordenados.length - 1],
      peorNoche: ordenados[0],
      logs,
    };
  }
}
