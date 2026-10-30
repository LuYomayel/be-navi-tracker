/**
 * Ciclos de tarjeta de crédito: un consumo entra en el ciclo que cierra el
 * `closingDay` (de ese mes si cae antes o ese día, si no del siguiente) y se
 * paga el `dueDay` posterior al cierre. Fechas como strings YYYY-MM-DD.
 */
export interface CardCycleConfig {
  closingDay: number; // 1-31 (se ajusta al último día en meses cortos)
  dueDay: number; // 1-31
}

export interface CardCycle {
  start: string; // primer día que entra en el ciclo
  closing: string; // día de cierre (inclusive)
  due: string; // vencimiento: se paga ese día
}

/** Sin configurar: mes calendario, vence el 10 del mes siguiente. */
export const DEFAULT_CYCLE: CardCycleConfig = { closingDay: 31, dueDay: 10 };

const pad = (n: number) => String(n).padStart(2, '0');

function shift(period: string, n: number): string {
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/** Fecha del día `day` del mes, ajustada al último día si no existe. */
export function dayIn(period: string, day: number): string {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return `${period}-${pad(Math.min(Math.max(day, 1), last))}`;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const n = new Date(Date.UTC(y, m - 1, d + 1));
  return n.toISOString().slice(0, 10);
}

/** Ciclo que cierra en el mes `period`. */
function cycleClosingIn(period: string, cfg: CardCycleConfig): CardCycle {
  const closing = dayIn(period, cfg.closingDay);
  const start = nextDay(dayIn(shift(period, -1), cfg.closingDay));
  // Vence el mismo mes si el día de pago viene después del cierre
  const duePeriod =
    cfg.dueDay > Number(closing.slice(8)) ? period : shift(period, 1);
  return { start, closing, due: dayIn(duePeriod, cfg.dueDay) };
}

/** Ciclo al que pertenece un consumo de la fecha dada. */
export function cycleOf(date: string, cfg: CardCycleConfig): CardCycle {
  const period = date.slice(0, 7);
  const here = cycleClosingIn(period, cfg);
  return date <= here.closing ? here : cycleClosingIn(shift(period, 1), cfg);
}

/** Ciclo cuyo vencimiento cae en el mes `month` (YYYY-MM). */
export function cycleDueIn(month: string, cfg: CardCycleConfig): CardCycle {
  const same = cycleClosingIn(month, cfg);
  return same.due.startsWith(month) ? same : cycleClosingIn(shift(month, -1), cfg);
}

/** Próximo ciclo a pagar: el primero con vencimiento hoy o después. */
export function nextDueCycle(today: string, cfg: CardCycleConfig): CardCycle {
  for (let n = -1; n <= 2; n++) {
    const c = cycleDueIn(shift(today.slice(0, 7), n), cfg);
    if (c.due >= today) return c;
  }
  return cycleDueIn(shift(today.slice(0, 7), 2), cfg);
}

/** Ciclo siguiente a uno dado. */
export function nextCycle(c: CardCycle, cfg: CardCycleConfig): CardCycle {
  return cycleOf(nextDay(c.closing), cfg);
}
