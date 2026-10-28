import {
  selectPendingSales,
  buildSaleUpdateFromMcpArgs,
  buildFilamentUpdateFromMcpArgs,
  formatRoll,
} from './printing-mcp-utils';

const sale = (over: any) => ({
  id: 's1',
  kind: 'venta',
  remaining: 1000,
  product: { name: 'Soporte celular' },
  ...over,
});

describe('selectPendingSales', () => {
  const sales = [
    sale({ id: 'a' }),
    sale({ id: 'b' }),
    sale({ id: 'c', product: { name: 'Katamino' } }),
    sale({ id: 'd', remaining: 0 }),
    sale({ id: 'e', kind: 'muestra' }),
  ];

  it('sin filtros devuelve las ventas con saldo (no muestras ni liquidadas)', () => {
    expect(selectPendingSales(sales, {}).map((s) => s.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('el id de la venta desempata dos ventas del mismo producto', () => {
    expect(
      selectPendingSales(sales, { ventaId: 'b', producto: 'soporte' }).map(
        (s) => s.id,
      ),
    ).toEqual(['b']);
  });

  it('un id de venta ya liquidada no devuelve nada', () => {
    expect(selectPendingSales(sales, { ventaId: 'd' })).toEqual([]);
  });

  it('filtra por nombre parcial del producto', () => {
    expect(
      selectPendingSales(sales, { producto: 'kata' }).map((s) => s.id),
    ).toEqual(['c']);
  });
});

describe('buildSaleUpdateFromMcpArgs', () => {
  it('mapea solo lo que viene', () => {
    expect(buildSaleUpdateFromMcpArgs({ cantidad: 17 })).toEqual({ qty: 17 });
    expect(
      buildSaleUpdateFromMcpArgs({
        precioUnitario: 5000,
        fecha: '2026-10-20',
        notas: 'x',
        canal: 'Miguelito',
      }),
    ).toEqual({
      chargedUnit: 5000,
      date: '2026-10-20',
      notes: 'x',
      channel: 'Miguelito',
    });
  });
});

describe('buildFilamentUpdateFromMcpArgs', () => {
  it('mapea gramos restantes, color y hex', () => {
    expect(
      buildFilamentUpdateFromMcpArgs({
        gramosRestantes: 169,
        color: 'naranja',
        colorHex: '#FF6910',
      }),
    ).toEqual({ gramsLeft: 169, color: 'naranja', colorHex: '#FF6910' });
  });

  it('gramos del rollo recalcula el $/g del lado del servicio (solo se pasa grams)', () => {
    expect(
      buildFilamentUpdateFromMcpArgs({ gramos: 1000, marca: 'Bambu Lab' }),
    ).toEqual({
      grams: 1000,
      brand: 'Bambu Lab',
    });
  });
});

describe('formatRoll', () => {
  it('muestra id, marca, material y gramos', () => {
    expect(
      formatRoll({
        id: 'fil-1',
        brand: 'Bambu Lab',
        material: 'PLA Lite',
        color: 'naranja',
        gramsLeft: 169.4,
        grams: 1000,
        purchasedAt: '2026-08-28',
        colorHex: '#ff6910',
      }),
    ).toBe(
      'Bambu Lab PLA Lite — 169g de 1000g · comprado 2026-08-28 · #ff6910 (id fil-1)',
    );
  });
});
