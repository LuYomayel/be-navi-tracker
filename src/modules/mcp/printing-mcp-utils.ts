/**
 * Helpers puros para las tools MCP del negocio 3D (ventas, pagos y rollos):
 * filtrado de ventas pendientes y mapeo de argumentos MCP (español) a los
 * DTOs de PrintingService. Separados del factory para testearlos sin
 * levantar el server MCP.
 */

interface SaleLike {
  id: string;
  kind: string;
  remaining: number;
  product?: { name?: string | null } | null;
}

/** Ventas con saldo, filtradas por id de venta y/o nombre parcial de producto. */
export function selectPendingSales<T extends SaleLike>(
  sales: T[],
  filters: { ventaId?: string; producto?: string },
): T[] {
  let pending = sales.filter((s) => s.kind === 'venta' && s.remaining > 0);
  if (filters.ventaId)
    pending = pending.filter((s) => s.id === filters.ventaId);
  if (filters.producto) {
    const q = filters.producto.toLowerCase();
    pending = pending.filter((s) => s.product?.name?.toLowerCase().includes(q));
  }
  return pending;
}

export interface EditarVentaArgs {
  cantidad?: number;
  precioUnitario?: number;
  fecha?: string;
  notas?: string;
  canal?: string;
}

export function buildSaleUpdateFromMcpArgs(a: EditarVentaArgs) {
  const dto: Record<string, unknown> = {};
  if (a.cantidad !== undefined) dto.qty = a.cantidad;
  if (a.precioUnitario !== undefined) dto.chargedUnit = a.precioUnitario;
  if (a.fecha !== undefined) dto.date = a.fecha;
  if (a.notas !== undefined) dto.notes = a.notas;
  if (a.canal !== undefined) dto.channel = a.canal;
  return dto;
}

export interface EditarFilamentoArgs {
  gramosRestantes?: number;
  gramos?: number;
  color?: string;
  colorHex?: string;
  marca?: string;
  material?: string;
  notas?: string;
}

export function buildFilamentUpdateFromMcpArgs(a: EditarFilamentoArgs) {
  const dto: Record<string, unknown> = {};
  if (a.gramosRestantes !== undefined) dto.gramsLeft = a.gramosRestantes;
  if (a.gramos !== undefined) dto.grams = a.gramos;
  if (a.color !== undefined) dto.color = a.color;
  if (a.colorHex !== undefined) dto.colorHex = a.colorHex;
  if (a.marca !== undefined) dto.brand = a.marca;
  if (a.material !== undefined) dto.material = a.material;
  if (a.notas !== undefined) dto.notes = a.notas;
  return dto;
}

interface RollLike {
  id: string;
  brand?: string;
  material?: string;
  color?: string;
  gramsLeft?: number | null;
  grams?: number;
  purchasedAt: string;
  colorHex?: string | null;
}

/** Una linea por rollo: "Bambu Lab PLA Lite — 169g de 1000g · comprado ... (id ...)". */
export function formatRoll(f: RollLike): string {
  const left =
    f.gramsLeft === null || f.gramsLeft === undefined
      ? '?'
      : Math.round(f.gramsLeft);
  return (
    `${f.brand ?? ''} ${f.material ?? ''} — ${left}g de ${f.grams ?? '?'}g · comprado ${f.purchasedAt}` +
    (f.colorHex ? ` · ${f.colorHex}` : '') +
    ` (id ${f.id})`
  );
}
