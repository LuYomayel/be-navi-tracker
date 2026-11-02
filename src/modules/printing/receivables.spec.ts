import { buildReceivables, ReceivableSale } from './receivables';

const sale = (over: Partial<ReceivableSale> = {}): ReceivableSale => ({
  id: 's1',
  date: '2026-10-27',
  kind: 'venta',
  qty: 1,
  channel: 'Juli',
  product: { name: 'KATAMINO' },
  total: 30000,
  settledAmount: 0,
  remaining: 30000,
  ...over,
});

describe('buildReceivables', () => {
  it('sin ventas da cero', () => {
    expect(buildReceivables([])).toEqual({
      total: 0,
      salesCount: 0,
      customers: [],
    });
  });

  it('suma lo que falta cobrar, no el total de la venta (pagos parciales)', () => {
    const r = buildReceivables([
      sale({ id: 'a', total: 40000, settledAmount: 30000, remaining: 10000 }),
    ]);
    expect(r.total).toBe(10000);
    expect(r.customers[0].sales[0]).toMatchObject({
      total: 40000,
      settledAmount: 30000,
      remaining: 10000,
    });
  });

  it('deja afuera lo ya cobrado y las muestras', () => {
    const r = buildReceivables([
      sale({ id: 'pagada', settledAmount: 30000, remaining: 0 }),
      sale({ id: 'regalada', kind: 'muestra', channel: 'Bruno' }),
      sale({ id: 'debe' }),
    ]);
    expect(r.salesCount).toBe(1);
    expect(r.customers[0].sales.map((s) => s.id)).toEqual(['debe']);
  });

  it('ignora los centavos sueltos de redondeo', () => {
    expect(buildReceivables([sale({ remaining: 0.01 })]).salesCount).toBe(0);
  });

  it('agrupa por persona y le saca el prefijo "pedido" al canal', () => {
    const r = buildReceivables([
      sale({ id: 'a', channel: 'pedido Miguelito', remaining: 25000 }),
      sale({ id: 'b', channel: 'miguelito ', remaining: 5000 }),
    ]);
    expect(r.customers).toHaveLength(1);
    expect(r.customers[0].name).toBe('Miguelito');
    expect(r.customers[0].total).toBe(30000);
  });

  it('una venta sin canal no se le atribuye a nadie', () => {
    const r = buildReceivables([sale({ channel: null })]);
    expect(r.customers[0].name).toBe('Sin nombre');
  });

  it('ordena: primero quien mas debe y, adentro, la venta mas vieja', () => {
    const r = buildReceivables([
      sale({ id: 'chico', channel: 'Alvaro', remaining: 10000 }),
      sale({ id: 'nueva', channel: 'Juli', date: '2026-10-27', remaining: 30000 }),
      sale({ id: 'vieja', channel: 'Juli', date: '2026-08-31', remaining: 5000 }),
    ]);
    expect(r.customers.map((c) => c.name)).toEqual(['Juli', 'Alvaro']);
    expect(r.customers[0].sales.map((s) => s.id)).toEqual(['vieja', 'nueva']);
  });

  it('caso real 02/11: Leandrito 40k, Juli 30k, Miguelito 25k y Alvaro 10k dan 105k', () => {
    const r = buildReceivables([
      sale({ id: '1', channel: 'Juli', remaining: 30000 }),
      sale({
        id: '2',
        channel: 'pedido Miguelito',
        qty: 17,
        product: { name: 'Soporte celular inclinable' },
        total: 85000,
        settledAmount: 60000,
        remaining: 25000,
      }),
      sale({
        id: '3',
        channel: 'Álvaro',
        total: 40000,
        settledAmount: 30000,
        remaining: 10000,
      }),
      sale({ id: '4', channel: 'Leandrito', total: 40000, remaining: 40000 }),
    ]);
    expect(r.total).toBe(105000);
    expect(r.salesCount).toBe(4);
    expect(r.customers.map((c) => [c.name, c.total])).toEqual([
      ['Leandrito', 40000],
      ['Juli', 30000],
      ['Miguelito', 25000],
      ['Álvaro', 10000],
    ]);
  });
});
