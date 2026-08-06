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

const ISO_RE = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g;

/**
 * Formato con el que Shortcuts entrega las fechas de Health cuando no se
 * formatean a mano: "6 Aug 2026 at 2:21 PM" (o "6 ago 2026, 14:21"). Y la
 * lista de muestras llega TODA pegada en una línea, así que hay que barrer
 * el texto entero, no parsear una sola.
 */
const LOCALIZED_RE =
  /(\d{1,2})\s+([a-zá-úñ]{3,12})\.?\s+(\d{4})(?:\s*(?:at|a las|,)\s*|\s+)(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?/gi;

const MONTHS: Record<string, number> = {
  jan: 0, ene: 0,
  feb: 1,
  mar: 2,
  apr: 3, abr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7, ago: 7,
  sep: 8, sept: 8,
  oct: 9,
  nov: 10,
  dec: 11, dic: 11,
};

/**
 * Todas las fechas que haya en el texto (ISO o localizadas), ordenadas. El
 * Watch parte la noche en fragmentos (Core/Deep/REM/Awake), así que el atajo
 * puede mandar la lista entera de muestras en un solo campo.
 */
export function parseInstants(value?: string | null): Date[] {
  if (!value) return [];
  const raw = String(value);
  const fechas: Date[] = [];

  for (const m of raw.match(ISO_RE) || []) {
    const d = new Date(m.replace(' ', 'T'));
    if (!Number.isNaN(d.getTime())) fechas.push(d);
  }

  for (const m of raw.matchAll(LOCALIZED_RE)) {
    const [, dia, mesTexto, anio, hora, min, meridiem] = m;
    const mes = MONTHS[mesTexto.toLowerCase().slice(0, 4)] ??
      MONTHS[mesTexto.toLowerCase().slice(0, 3)];
    if (mes === undefined) continue;
    let h = Number(hora);
    const mer = meridiem?.replace(/[.\s]/g, '').toLowerCase();
    if (mer === 'pm' && h < 12) h += 12;
    if (mer === 'am' && h === 12) h = 0;
    const d = new Date(Number(anio), mes, Number(dia), h, Number(min));
    if (!Number.isNaN(d.getTime())) fechas.push(d);
  }

  return fechas.sort((a, b) => a.getTime() - b.getTime());
}

/** Hueco máximo entre dos muestras para seguir siendo la misma noche. */
const MAX_GAP_MIN = 3 * 60;

/**
 * De todas las muestras que llegaron, la ventana de la ÚLTIMA noche.
 *
 * El filtro de Shortcuts no tiene unidad de horas (lo más chico es "1 day"),
 * así que la búsqueda trae también las siestas de ayer. La noche es el
 * último bloque de muestras encadenadas: se arranca de la más reciente y se
 * camina para atrás mientras el hueco con la anterior sea chico.
 */
export function nightWindow(
  from?: string | null,
  to?: string | null,
): { start: Date; end: Date } | null {
  const inicios = parseInstants(from);
  const fines = parseInstants(to);
  if (!inicios.length || !fines.length) return null;

  // Sin poder aparear inicios con fines, se usa todo el rango.
  if (inicios.length !== fines.length) {
    return { start: inicios[0], end: fines[fines.length - 1] };
  }

  const tramos = inicios.map((start, i) => ({ start, end: fines[i] }));
  let desde = tramos.length - 1;
  for (let i = tramos.length - 1; i > 0; i--) {
    const hueco =
      (tramos[i].start.getTime() - tramos[i - 1].end.getTime()) / 60000;
    if (hueco > MAX_GAP_MIN) break;
    desde = i - 1;
  }
  return { start: tramos[desde].start, end: tramos[tramos.length - 1].end };
}

/**
 * Minutos dormidos. Con fechas completas mide la última noche entera
 * (fragmentos incluidos, siestas afuera). Con horarios sueltos ("23:15"),
 * cruza la medianoche.
 */
export function minutesBetween(
  from?: string | null,
  to?: string | null,
): number | null {
  const noche = nightWindow(from, to);
  if (noche) {
    const diff = Math.round(
      (noche.end.getTime() - noche.start.getTime()) / 60000,
    );
    return diff > 0 ? diff : null;
  }

  const a = parseClock(from);
  const b = parseClock(to);
  if (!a || !b) return null;
  const [ah, am] = a.split(':').map(Number);
  const [bh, bm] = b.split(':').map(Number);
  let diff = bh * 60 + bm - (ah * 60 + am);
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * Hora "HH:mm" de la primera (o última) marca de una lista de fechas.
 * Pasando la lista contraria (`counterpart`) se limita a la última noche, y
 * así la hora de acostarse no sale de una siesta de la tarde.
 */
export function clockFromList(
  value: string | null | undefined,
  which: 'first' | 'last',
  counterpart?: string | null,
): string | null {
  if (counterpart) {
    const noche =
      which === 'first'
        ? nightWindow(value, counterpart)
        : nightWindow(counterpart, value);
    if (noche) return hhmm(which === 'first' ? noche.start : noche.end);
  }
  const instants = parseInstants(value);
  if (!instants.length) return parseClock(value);
  return hhmm(which === 'first' ? instants[0] : instants[instants.length - 1]);
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
