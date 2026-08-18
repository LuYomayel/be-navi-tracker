/**
 * Logica pura del stock de filamento por color (sin DB, testeable aislada).
 *
 * El stock real vive en Filament.gramsLeft:
 *   - null      => rollo sin trackear (no suma ni resta, se avisa aparte)
 *   - 0         => vacio
 *   - discarded / finishedAt => fuera del stock
 *
 * El matcheo de colores tiene dos vias: por hex (lo que reporta Bambu, con
 * alpha RGBA de 8 digitos) y por nombre normalizado. El hex gana si ambos
 * lados lo tienen; el nombre es el fallback humano.
 */

export interface FilamentLike {
  id: string;
  color: string;
  colorHex?: string | null;
  gramsLeft?: number | null;
  purchasedAt: string;
  discarded: boolean;
  finishedAt?: string | null;
  brand?: string;
  material?: string;
}

export interface NeedItem {
  color?: string | null;
  colorHex?: string | null;
  grams: number;
  filamentId?: string | null;
}

export interface ColorStock {
  color: string;
  colorHex: string | null;
  totalGrams: number;
  rolls: { id: string; brand?: string; material?: string; gramsLeft: number; purchasedAt: string }[];
}

export function normColor(c?: string | null): string {
  return (c ?? '').trim().toLowerCase();
}

/** "#00AE42", "00AE42FF" (RGBA Bambu) o "00ae42" -> "00ae42". Invalido -> null. */
export function normHex(h?: string | null): string | null {
  if (!h) return null;
  const clean = h.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{8}$/.test(clean)) return clean.slice(0, 6);
  if (/^[0-9a-f]{6}$/.test(clean)) return clean;
  return null;
}

/** Rollo que cuenta para el stock: activo y con gramos trackeados. */
function isActiveTracked(f: FilamentLike): boolean {
  return (
    !f.discarded &&
    !f.finishedAt &&
    f.gramsLeft !== null &&
    f.gramsLeft !== undefined &&
    f.gramsLeft > 0
  );
}

/** Rollo activo pero sin stock trackeado (gramsLeft null): se avisa aparte. */
export function countUntracked(filaments: FilamentLike[]): number {
  return filaments.filter(
    (f) => !f.discarded && !f.finishedAt && (f.gramsLeft === null || f.gramsLeft === undefined),
  ).length;
}

/** Agrupa el stock disponible por color (nombre normalizado). */
export function buildStock(filaments: FilamentLike[]): ColorStock[] {
  const byColor = new Map<string, ColorStock>();
  for (const f of filaments.filter(isActiveTracked)) {
    const key = normColor(f.color);
    let entry = byColor.get(key);
    if (!entry) {
      entry = { color: key, colorHex: null, totalGrams: 0, rolls: [] };
      byColor.set(key, entry);
    }
    entry.totalGrams += f.gramsLeft!;
    entry.colorHex = entry.colorHex ?? normHex(f.colorHex);
    entry.rolls.push({
      id: f.id,
      brand: f.brand,
      material: f.material,
      gramsLeft: f.gramsLeft!,
      purchasedAt: f.purchasedAt,
    });
  }
  return [...byColor.values()].sort((a, b) => b.totalGrams - a.totalGrams);
}

/** Suma items repetidos del mismo color (por hex si hay, sino por nombre). */
export function aggregateNeeds(items: NeedItem[]): NeedItem[] {
  const map = new Map<string, NeedItem>();
  for (const item of items) {
    const hex = normHex(item.colorHex);
    const key = hex ? `hex:${hex}` : `name:${normColor(item.color)}`;
    const prev = map.get(key);
    if (prev) prev.grams += item.grams;
    else map.set(key, { color: normColor(item.color) || undefined, colorHex: hex, grams: item.grams });
  }
  return [...map.values()];
}

/**
 * Rollos activos que matchean el color pedido, FIFO (mas viejo primero).
 * Dos pasos: primero por hex/nombre directo, y despues se suman los rollos
 * SIN hex que comparten nombre con uno ya matcheado por hex (caso tipico:
 * Bambu reporta #000000 y hay un rollo "negro" viejo sin hex cargado).
 */
function matchingRolls(need: NeedItem, filaments: FilamentLike[]): FilamentLike[] {
  const hex = normHex(need.colorHex);
  const name = normColor(need.color);
  const active = filaments.filter(isActiveTracked);

  const direct = active.filter((f) => {
    const fHex = normHex(f.colorHex);
    if (hex && fHex && fHex === hex) return true;
    if (name && normColor(f.color) === name) return true;
    return false;
  });

  const names = new Set(direct.map((f) => normColor(f.color)));
  const byName = hex
    ? active.filter((f) => !normHex(f.colorHex) && names.has(normColor(f.color)))
    : [];

  return [...new Set([...direct, ...byName])].sort((a, b) =>
    a.purchasedAt.localeCompare(b.purchasedAt),
  );
}

export interface StockCheckResult {
  ok: boolean;
  perColor: {
    color: string;
    needed: number;
    available: number;
    missing: number;
    matched: boolean;
  }[];
  untrackedRolls: number;
}

/** ¿Alcanza el stock actual para imprimir estos consumos? */
export function checkStock(
  items: NeedItem[],
  filaments: FilamentLike[],
): StockCheckResult {
  const needs = aggregateNeeds(items);
  const perColor = needs.map((need) => {
    const rolls = matchingRolls(need, filaments);
    const available = rolls.reduce((a, f) => a + (f.gramsLeft ?? 0), 0);
    const missing = Math.max(0, Math.round((need.grams - available) * 10) / 10);
    return {
      color: need.color || normHex(need.colorHex) || '?',
      needed: need.grams,
      available,
      missing,
      matched: rolls.length > 0,
    };
  });
  return {
    ok: perColor.every((c) => c.missing === 0),
    perColor,
    untrackedRolls: countUntracked(filaments),
  };
}

export interface DeductionStep {
  filamentId: string;
  grams: number;
}

/**
 * Plan de descuento para un consumo: filamentId explicito manda; sino
 * FIFO sobre los rollos del color, cascadeando cuando uno no alcanza.
 */
export function planDeduction(
  need: NeedItem,
  filaments: FilamentLike[],
): { plan: DeductionStep[]; unmatchedGrams: number } {
  if (need.filamentId) {
    const roll = filaments.find((f) => f.id === need.filamentId);
    if (roll && isActiveTracked(roll)) {
      return { plan: [{ filamentId: roll.id, grams: need.grams }], unmatchedGrams: 0 };
    }
    return { plan: [], unmatchedGrams: need.grams };
  }
  const rolls = matchingRolls(need, filaments);
  const plan: DeductionStep[] = [];
  let remaining = need.grams;
  for (const roll of rolls) {
    if (remaining <= 0) break;
    const take = Math.min(roll.gramsLeft!, remaining);
    plan.push({ filamentId: roll.id, grams: Math.round(take * 10) / 10 });
    remaining -= take;
  }
  return { plan, unmatchedGrams: Math.max(0, Math.round(remaining * 10) / 10) };
}
