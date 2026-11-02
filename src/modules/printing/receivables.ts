/** Una venta con su cobrado/restante ya resueltos (settledInfo, legacy-aware). */
export interface ReceivableSale {
  id: string;
  date: string;
  kind: string;
  qty: number;
  channel?: string | null;
  product?: { name: string } | null;
  total: number;
  settledAmount: number;
  remaining: number;
}

export interface ReceivableLine {
  id: string;
  date: string;
  qty: number;
  productName: string;
  total: number;
  settledAmount: number;
  remaining: number;
}

export interface ReceivableCustomer {
  name: string;
  total: number;
  sales: ReceivableLine[];
}

export interface Receivables {
  total: number;
  salesCount: number;
  customers: ReceivableCustomer[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
// Mismo margen que las liquidaciones: unos centavos no son una deuda.
const EPS = 0.01;

const customerName = (channel?: string | null) =>
  (channel ?? '').replace(/^\s*pedido\s+/i, '').trim() || 'Sin nombre';

const customerKey = (name: string) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/**
 * Lo que ya se entrego y falta que paguen. Las ventas nacen al entregar
 * (retroceder el pedido las borra), asi que un pedido en curso nunca suma.
 */
export function buildReceivables(sales: ReceivableSale[]): Receivables {
  const byCustomer = new Map<string, ReceivableCustomer>();

  for (const s of sales) {
    if (s.kind !== 'venta' || s.remaining <= EPS) continue;
    const name = customerName(s.channel);
    const key = customerKey(name);
    const customer = byCustomer.get(key) ?? { name, total: 0, sales: [] };
    customer.total = round2(customer.total + s.remaining);
    customer.sales.push({
      id: s.id,
      date: s.date,
      qty: s.qty,
      productName: s.product?.name ?? 'Producto',
      total: s.total,
      settledAmount: s.settledAmount,
      remaining: s.remaining,
    });
    byCustomer.set(key, customer);
  }

  const customers = [...byCustomer.values()].sort((a, b) => b.total - a.total);
  for (const c of customers) {
    c.sales.sort((a, b) => a.date.localeCompare(b.date));
  }

  return {
    total: round2(customers.reduce((a, c) => a + c.total, 0)),
    salesCount: customers.reduce((a, c) => a + c.sales.length, 0),
    customers,
  };
}
