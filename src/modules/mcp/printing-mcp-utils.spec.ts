import {
  selectPendingSales,
  buildSaleUpdateFromMcpArgs,
  buildFilamentUpdateFromMcpArgs,
  formatRoll,
  resolvePart,
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

describe('resolvePart', () => {
  const parts = [
    {
      id: 'c-punta',
      key: 'punta',
      name: 'Punta de zanahoria',
      productName: 'Carrot memotest',
    },
    { id: 'c-dado', key: 'dado', name: 'Dado', productName: 'Carrot memotest' },
    {
      id: 't-dado',
      key: 'dado',
      name: 'Dado',
      productName: 'TETRIS de equilibrio',
    },
    {
      id: 't-l3',
      key: 'ladrillo-3',
      name: 'Ladrillo set 3',
      productName: 'TETRIS de equilibrio',
    },
  ];

  it('encuentra por key o por nombre, sin importar mayusculas ni tildes', () => {
    expect(resolvePart(parts, 'Punta').part?.id).toBe('c-punta');
    expect(resolvePart(parts, 'ladrillo 3').part?.id).toBe('t-l3');
  });

  it('si la pieza existe en dos productos pide el producto', () => {
    const res = resolvePart(parts, 'dado');
    expect(res.part).toBeUndefined();
    expect(res.error).toMatch(/Carrot memotest/);
    expect(resolvePart(parts, 'dado', 'tetris').part?.id).toBe('t-dado');
  });

  it('pieza inexistente lista las disponibles', () => {
    expect(resolvePart(parts, 'tornillo').error).toMatch(/Punta de zanahoria/);
  });
});
