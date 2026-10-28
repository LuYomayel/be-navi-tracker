/**
 * Logica pura del stock de PIEZAS impresas (sin DB, testeable aislada).
 *
 * Un producto se arma con una receta de lineas (pieza x cantidad) y cada
 * linea tiene una regla de color:
 *   - fijo:      siempre el mismo color (Katamino, tablero marron del Carrot)
 *   - libre:     cualquier color, se puede mezclar (soporte armado)
 *   - juego:     las lineas del mismo `group` van del MISMO color dentro de
 *                una unidad (estructura del Tetr_s: todo negro o todo blanco)
 *   - distintos: las lineas del mismo `group` se reparten en `slot`s; las de
 *                un slot comparten color y cada slot lleva un color distinto
 *                (Carrot: 6 slots {punta, cara} => 6 colores, caras = puntas)
 *
 * El stock es la suma de movimientos por (pieza, color). Para contar cuantas
 * unidades se pueden armar se arma unidad por unidad sobre una copia del
 * stock, y lo mismo sirve para planear que se consume al entregar.
 */

export type ColorMode = 'fijo' | 'libre' | 'juego' | 'distintos';

export interface RecipeLine {
  partId: string;
  qty: number;
  colorMode: ColorMode;
  fixedColor?: string | null;
  group?: string | null;
  slot?: string | null;
}

export interface PartMove {
  partId: string;
  color: string;
  qty: number;
}

/** Stock por clave "partId|color". */
export type PartStock = Map<string, number>;

const key = (partId: string, color: string) => `${partId}|${color}`;

export function stockFromMoves(moves: PartMove[]): PartStock {
  const stock: PartStock = new Map();
  for (const m of moves) {
    stock.set(
      key(m.partId, m.color),
      (stock.get(key(m.partId, m.color)) ?? 0) + m.qty,
    );
  }
  return stock;
}

/** Colores que tienen stock (> 0) de una pieza. */
function colorsOf(stock: PartStock, partId: string): string[] {
  const out: string[] = [];
  for (const [k, qty] of stock) {
    const [p, color] = k.split('|');
    if (p === partId && qty > 0) out.push(color);
  }
  return out;
}

const has = (stock: PartStock, partId: string, color: string, qty: number) =>
  (stock.get(key(partId, color)) ?? 0) >= qty;

/** Cuantas veces entra un conjunto de lineas en un color (para preferir el mas completo). */
function capacity(
  stock: PartStock,
  lines: RecipeLine[],
  color: string,
): number {
  return Math.min(
    ...lines.map((l) =>
      Math.floor((stock.get(key(l.partId, color)) ?? 0) / l.qty),
    ),
  );
}

export interface PlanOptions {
  /** Color elegido para un grupo `juego` (ej { estructura: 'blanco' }). */
  groupColors?: Record<string, string>;
  /** Color para cualquier grupo `juego` sin color propio (ej "el Tetr_s blanco"). */
  anyGroupColor?: string;
  /** Nombres legibles para los mensajes de faltantes. */
  partNames?: Record<string, string>;
}

/**
 * Arma UNA unidad sobre `stock` (lo modifica si sale bien). Devuelve los
 * movimientos consumidos o los motivos por los que no se puede.
 */
function planUnit(
  lines: RecipeLine[],
  stock: PartStock,
  opts: PlanOptions,
): { moves: PartMove[] } | { missing: string[] } {
  const name = (id: string) => opts.partNames?.[id] ?? id;
  const work: PartStock = new Map(stock);
  const moves: PartMove[] = [];
  const missing: string[] = [];
  const take = (partId: string, color: string, qty: number) => {
    work.set(key(partId, color), (work.get(key(partId, color)) ?? 0) - qty);
    moves.push({ partId, color, qty });
  };

  // 1) fijos
  for (const l of lines.filter((x) => x.colorMode === 'fijo')) {
    const color = l.fixedColor ?? '';
    if (!has(work, l.partId, color, l.qty)) {
      missing.push(
        `${name(l.partId)} ${color}: faltan ${l.qty - Math.max(0, work.get(key(l.partId, color)) ?? 0)}`,
      );
    } else take(l.partId, color, l.qty);
  }

  // 2) juegos: un color para todo el grupo
  const groups = (mode: ColorMode) => {
    const m = new Map<string, RecipeLine[]>();
    for (const l of lines.filter((x) => x.colorMode === mode)) {
      const g = l.group ?? '_';
      m.set(g, [...(m.get(g) ?? []), l]);
    }
    return m;
  };
  for (const [group, gl] of groups('juego')) {
    const colorsAll = new Set(gl.flatMap((l) => colorsOf(work, l.partId)));
    const candidates = [...colorsAll].filter((c) => capacity(work, gl, c) >= 1);
    const wanted = opts.groupColors?.[group] ?? opts.anyGroupColor;
    const color = wanted
      ? candidates.includes(wanted)
        ? wanted
        : null
      : candidates.sort(
          (a, b) => capacity(work, gl, b) - capacity(work, gl, a),
        )[0];
    if (!color) {
      missing.push(
        wanted
          ? `${group}: no hay juego completo en ${wanted}`
          : `${group}: no hay un juego completo del mismo color (${gl.map((l) => name(l.partId)).join(' + ')})`,
      );
      continue;
    }
    for (const l of gl) take(l.partId, color, l.qty);
  }

  // 3) distintos: asignar un color distinto a cada slot (matching bipartito)
  for (const [group, gl] of groups('distintos')) {
    const slots = new Map<string, RecipeLine[]>();
    for (const l of gl) {
      const s = l.slot ?? l.partId;
      slots.set(s, [...(slots.get(s) ?? []), l]);
    }
    const slotIds = [...slots.keys()];
    const allColors = [...new Set(gl.flatMap((l) => colorsOf(work, l.partId)))];
    const cand = new Map(
      slotIds.map((s) => [
        s,
        allColors
          .filter((c) => capacity(work, slots.get(s)!, c) >= 1)
          .sort(
            (a, b) =>
              capacity(work, slots.get(s)!, b) -
              capacity(work, slots.get(s)!, a),
          ),
      ]),
    );
    const owner = new Map<string, string>(); // color -> slot
    const tryAssign = (slot: string, seen: Set<string>): boolean => {
      for (const c of cand.get(slot)!) {
        if (seen.has(c)) continue;
        seen.add(c);
        const prev = owner.get(c);
        if (!prev || tryAssign(prev, seen)) {
          owner.set(c, slot);
          return true;
        }
      }
      return false;
    };
    const order = [...slotIds].sort(
      (a, b) => cand.get(a)!.length - cand.get(b)!.length,
    );
    let assigned = 0;
    for (const s of order) if (tryAssign(s, new Set())) assigned++;
    if (assigned < slotIds.length) {
      // Si todos los colores llevan las mismas piezas (Carrot) se nombran;
      // si cada color tiene su set propio (Tetr_s) seria una lista eterna.
      const desc = (s: string) =>
        slots
          .get(s)!
          .map((l) => `${name(l.partId)} ×${l.qty}`)
          .join(' + ');
      const same = slotIds.every((s) => desc(s) === desc(slotIds[0]));
      missing.push(
        `${group}: hacen falta ${slotIds.length} colores distintos, cada uno con ${same ? desc(slotIds[0]) : 'su set completo'}; hay ${assigned} de ${slotIds.length}`,
      );
      continue;
    }
    for (const [color, slot] of owner) {
      for (const l of slots.get(slot)!) take(l.partId, color, l.qty);
    }
  }

  // 4) libres: de los colores con mas stock, mezclando si hace falta
  for (const l of lines.filter((x) => x.colorMode === 'libre')) {
    let need = l.qty;
    const colors = colorsOf(work, l.partId).sort(
      (a, b) =>
        (work.get(key(l.partId, b)) ?? 0) - (work.get(key(l.partId, a)) ?? 0),
    );
    const steps: [string, number][] = [];
    for (const c of colors) {
      if (need <= 0) break;
      const n = Math.min(need, work.get(key(l.partId, c)) ?? 0);
      steps.push([c, n]);
      need -= n;
    }
    if (need > 0) missing.push(`${name(l.partId)}: faltan ${need}`);
    else for (const [c, n] of steps) take(l.partId, c, n);
  }

  if (missing.length) return { missing };
  for (const [k, v] of work) stock.set(k, v);
  return { moves };
}

/** Cuantas unidades se pueden armar y que falta para la siguiente. */
export function countBuildable(
  lines: RecipeLine[],
  stock: PartStock,
  opts: PlanOptions = {},
  max = 99,
): { buildable: number; missing: string[] } {
  if (!lines.length) return { buildable: 0, missing: ['sin receta de piezas'] };
  const partIds = new Set(lines.map((l) => l.partId));
  const anyPrinted = [...stock].some(
    ([k, qty]) => qty > 0 && partIds.has(k.split('|')[0]),
  );
  if (!anyPrinted) {
    return { buildable: 0, missing: ['no hay ninguna pieza impresa todavía'] };
  }
  const work: PartStock = new Map(stock);
  let buildable = 0;
  while (buildable < max) {
    const res = planUnit(lines, work, opts);
    if ('missing' in res) {
      // Mas de 3 faltantes es una pared (Katamino: 15 "faltan 1").
      const missing =
        res.missing.length > 3
          ? [...res.missing.slice(0, 3), `y ${res.missing.length - 3} más`]
          : res.missing;
      return { buildable, missing };
    }
    buildable++;
  }
  return { buildable, missing: [] };
}

/** Que piezas (y de que color) se consumen para armar `n` unidades. */
export function planConsumption(
  lines: RecipeLine[],
  stock: PartStock,
  n: number,
  opts: PlanOptions = {},
): { built: number; moves: PartMove[]; shortfall: string[] } {
  const work: PartStock = new Map(stock);
  const agg = new Map<string, PartMove>();
  let built = 0;
  let shortfall: string[] = [];
  for (let i = 0; i < n; i++) {
    const res = lines.length
      ? planUnit(lines, work, opts)
      : { missing: ['sin receta de piezas'] };
    if ('missing' in res) {
      shortfall = [`faltan ${n - built} de ${n}: ${res.missing.join(' · ')}`];
      break;
    }
    built++;
    for (const m of res.moves) {
      const k = key(m.partId, m.color);
      const prev = agg.get(k);
      if (prev) prev.qty += m.qty;
      else agg.set(k, { ...m });
    }
  }
  return { built, moves: [...agg.values()], shortfall };
}
