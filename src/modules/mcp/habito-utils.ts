/**
 * Utilidades para las tools MCP de habitos (crear/editar/eliminar).
 *
 * El array `days` del modelo Activity son 7 booleans en orden argentino:
 * [L, M, X, J, V, S, D] = [Lunes, Martes, Miercoles, Jueves, Viernes, Sabado, Domingo].
 */

export const TODOS_LOS_DIAS: boolean[] = [
  true,
  true,
  true,
  true,
  true,
  true,
  true,
];

/** Etiquetas cortas por indice (orden L..D). */
const LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

/** Normaliza: minusculas y sin acentos (quita marcas diacriticas combinantes). */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Mapea un token suelto al indice de dia (0..6) o null si no se reconoce. */
function tokenADia(tokenRaw: string): number | null {
  const t = normalize(tokenRaw);
  if (!t) return null;
  const map: Record<string, number> = {
    // letras estilo argentino
    l: 0,
    m: 1,
    x: 2,
    j: 3,
    v: 4,
    s: 5,
    d: 6,
    // abreviaturas
    lun: 0,
    mar: 1,
    mie: 2,
    jue: 3,
    vie: 4,
    sab: 5,
    dom: 6,
    // nombres completos
    lunes: 0,
    martes: 1,
    miercoles: 2,
    jueves: 3,
    viernes: 4,
    sabado: 5,
    domingo: 6,
  };
  return t in map ? map[t] : null;
}

/**
 * Convierte una descripcion de dias (lenguaje natural) en un array de 7 booleans.
 * Acepta string ("L,M,V" / "lun mie vie" / "todos" / "finde") o array de tokens.
 * Si no se reconoce ningun dia valido, cae a "todos los dias".
 */
export function parseDiasHabito(input?: string | string[]): boolean[] {
  if (input == null) return [...TODOS_LOS_DIAS];

  const raw = Array.isArray(input) ? input.join(' ') : input;
  const norm = normalize(raw);
  if (!norm) return [...TODOS_LOS_DIAS];

  // Atajos de conjunto.
  if (/\b(todos|diario|diaria|cada dia|todos los dias)\b/.test(norm)) {
    return [...TODOS_LOS_DIAS];
  }

  const days = [false, false, false, false, false, false, false];
  let any = false;

  const setRange = (idxs: number[]) => {
    idxs.forEach((i) => {
      days[i] = true;
    });
    any = true;
  };

  if (/\b(finde|fin de semana|findes)\b/.test(norm)) setRange([5, 6]);
  if (/\b(habiles|semana|laborales|entre semana)\b/.test(norm))
    setRange([0, 1, 2, 3, 4]);

  // Tokens individuales, separados por coma / espacio / ";" / "y".
  for (const tok of norm.split(/[\s,;]+|\by\b/)) {
    const idx = tokenADia(tok);
    if (idx !== null) {
      days[idx] = true;
      any = true;
    }
  }

  return any ? days : [...TODOS_LOS_DIAS];
}

/** Formatea el array de dias para mostrar en confirmaciones. */
export function formatDias(days: boolean[]): string {
  if (days.length === 7 && days.every(Boolean)) return 'todos los dias';
  const sel = LABELS.filter((_, i) => days[i]);
  return sel.length ? sel.join(', ') : '(ningun dia)';
}

const DEFAULT_COLOR = '#22c55e';
const HEX_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/;

/** Devuelve un color hex valido: el provisto si es valido, o el default. */
export function resolveColorHabito(color?: string): string {
  if (color && HEX_RE.test(color.trim())) return color.trim();
  return DEFAULT_COLOR;
}
