/**
 * Utilidades de fecha con soporte de zona horaria local (Argentina, UTC-3).
 *
 * El servidor puede correr en UTC. Todas las funciones aquí usan
 * Intl.DateTimeFormat con la zona horaria de Argentina para que las
 * fechas siempre reflejen el día/hora local del usuario.
 */
const TZ = 'America/Argentina/Buenos_Aires';

/**
 * Devuelve la fecha local de hoy en formato YYYY-MM-DD (zona horaria Argentina).
 */
export function getLocalDateString(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/**
 * Convierte un objeto Date a YYYY-MM-DD usando la zona horaria de Argentina.
 * Usar cuando se tiene un Date que representa "ahora" y se quiere la fecha local.
 */
export function toLocalDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Devuelve la hora local actual (0-23) en la zona horaria de Argentina.
 */
export function getLocalHour(): number {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour: 'numeric',
    hour12: false,
  }).format(new Date());
  return parseInt(hourStr, 10);
}
