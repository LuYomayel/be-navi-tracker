import { Test, TestingModule } from '@nestjs/testing';
import {
  MercadoPagoService,
  parseSettlementCsv,
  classifyRow,
  matchCategoryName,
} from './mercadopago.service';
import { PrismaService } from '../../config/prisma.service';

const HEADER =
  'EXTERNAL_REFERENCE;SOURCE_ID;USER_ID;PAYMENT_METHOD_TYPE;PAYMENT_METHOD;SITE;TRANSACTION_TYPE;TRANSACTION_AMOUNT;TRANSACTION_CURRENCY;TRANSACTION_DATE;FEE_AMOUNT;SETTLEMENT_NET_AMOUNT;SETTLEMENT_CURRENCY;SETTLEMENT_DATE;DESCRIPTION';

const row = (over: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = {
    EXTERNAL_REFERENCE: '',
    SOURCE_ID: '111',
    USER_ID: '999',
    PAYMENT_METHOD_TYPE: 'available_money',
    PAYMENT_METHOD: 'account_money',
    SITE: 'MLA',
    TRANSACTION_TYPE: 'SETTLEMENT',
    TRANSACTION_AMOUNT: '-15000.00',
    TRANSACTION_CURRENCY: 'ARS',
    TRANSACTION_DATE: '2026-08-04T21:00:00.000-04:00',
    FEE_AMOUNT: '0.00',
    SETTLEMENT_NET_AMOUNT: '-15000.00',
    SETTLEMENT_CURRENCY: 'ARS',
    SETTLEMENT_DATE: '2026-08-04T21:00:00.000-04:00',
    DESCRIPTION: 'transfer',
  };
  return { ...base, ...over };
};

const toCsvLine = (r: Record<string, string>) =>
  HEADER.split(';')
    .map((k) => r[k] ?? '')
    .join(';');

describe('parseSettlementCsv', () => {
  it('should parse a semicolon-separated report into keyed rows', () => {
    const csv = [HEADER, toCsvLine(row()), toCsvLine(row({ SOURCE_ID: '222' }))].join(
      '\n',
    );

    const rows = parseSettlementCsv(csv);

    expect(rows).toHaveLength(2);
    expect(rows[0].SOURCE_ID).toBe('111');
    expect(rows[1].SOURCE_ID).toBe('222');
    expect(rows[0].TRANSACTION_TYPE).toBe('SETTLEMENT');
  });

  it('should skip empty lines', () => {
    const csv = [HEADER, toCsvLine(row()), '', '  '].join('\n');
    expect(parseSettlementCsv(csv)).toHaveLength(1);
  });
});

describe('classifyRow', () => {
  it('should classify a negative net amount as gasto with ART date', () => {
    // 21:00 -04:00 = 22:00 ART del mismo día
    const m = classifyRow(row());
    expect(m.kind).toBe('gasto');
    expect(m.amount).toBe(15000);
    expect(m.date).toBe('2026-08-04');
    expect(m.sourceId).toBe('111');
  });

  it('should classify a positive net amount as ingreso (no se autocrea)', () => {
    const m = classifyRow(
      row({ TRANSACTION_AMOUNT: '25000.00', SETTLEMENT_NET_AMOUNT: '25000.00' }),
    );
    expect(m.kind).toBe('ingreso');
    expect(m.amount).toBe(25000);
  });

  it('should skip withdrawals (retiro a cuenta bancaria propia)', () => {
    const m = classifyRow(
      row({
        TRANSACTION_TYPE: 'WITHDRAWAL',
        SETTLEMENT_NET_AMOUNT: '-1100000.00',
      }),
    );
    expect(m.kind).toBe('skip');
    expect(m.reason).toContain('cuenta propia');
  });

  it('should skip negative PAYOUTS (transferencia a CBU, puede ser cuenta propia)', () => {
    const m = classifyRow(
      row({
        TRANSACTION_TYPE: 'PAYOUTS',
        SETTLEMENT_NET_AMOUNT: '-1100000.00',
      }),
    );
    expect(m.kind).toBe('skip');
    expect(m.reason).toContain('CBU');
    // Un PAYOUT positivo (cancelación devuelta) no es gasto: cae como ingreso
    expect(
      classifyRow(
        row({ TRANSACTION_TYPE: 'PAYOUTS', SETTLEMENT_NET_AMOUNT: '500.00' }),
      ).kind,
    ).toBe('ingreso');
  });

  it('should skip zero-amount rows and fall back to TRANSACTION_AMOUNT', () => {
    expect(
      classifyRow(row({ SETTLEMENT_NET_AMOUNT: '0.00', TRANSACTION_AMOUNT: '0.00' }))
        .kind,
    ).toBe('skip');
    const m = classifyRow(
      row({ SETTLEMENT_NET_AMOUNT: '', TRANSACTION_AMOUNT: '-500.50' }),
    );
    expect(m.kind).toBe('gasto');
    expect(m.amount).toBe(500.5);
  });
});

describe('matchCategoryName', () => {
  it('should map merchants to canonical category names', () => {
    expect(matchCategoryName('Ausa - pago de peaje')).toBe('Transporte');
    expect(matchCategoryName("Mcdonald's pago en tienda")).toBe('Comida');
    expect(matchCategoryName('Meli+ pago automático')).toBe('Suscripciones');
    expect(matchCategoryName('Coto sucursal 22')).toBe('Supermercado');
    expect(matchCategoryName('Transferencia a Juan')).toBeNull();
  });
});

describe('MercadoPagoService.sync', () => {
  let service: MercadoPagoService;
  let prisma: PrismaService;
  const userId = 'user-1';

  const csv = [
    HEADER,
    // gasto nuevo
    toCsvLine(row({ SOURCE_ID: 'mp-1', DESCRIPTION: 'Ausa peaje' })),
    // ya importado (dedup por externalId)
    toCsvLine(row({ SOURCE_ID: 'mp-2' })),
    // retiro propio (skip)
    toCsvLine(
      row({ SOURCE_ID: 'mp-3', TRANSACTION_TYPE: 'WITHDRAWAL' }),
    ),
    // ingreso (solo se reporta)
    toCsvLine(
      row({
        SOURCE_ID: 'mp-4',
        TRANSACTION_AMOUNT: '25000.00',
        SETTLEMENT_NET_AMOUNT: '25000.00',
        DESCRIPTION: 'venta suscripcion',
      }),
    ),
  ].join('\n');

  beforeEach(async () => {
    process.env.MP_ACCESS_TOKEN = 'TEST-TOKEN';
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MercadoPagoService,
        {
          provide: PrismaService,
          useValue: {
            user: { findFirst: jest.fn().mockResolvedValue({ id: userId }) },
            expense: {
              findFirst: jest.fn().mockResolvedValue(null),
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'new', ...data }),
              ),
            },
            expenseCategory: {
              findMany: jest
                .fn()
                .mockResolvedValue([{ id: 'cat-tr', name: 'Transporte' }]),
            },
            mpSyncLog: {
              create: jest.fn().mockResolvedValue({}),
              findMany: jest.fn().mockResolvedValue([]),
            },
          },
        },
      ],
    }).compile();

    service = module.get(MercadoPagoService);
    prisma = module.get(PrismaService);

    global.fetch = jest.fn(async (url: any, init?: any) => {
      const u = String(url);
      if (u.endsWith('/config'))
        return { status: 200, ok: true, json: async () => ({}) } as any;
      if (u.endsWith('/settlement_report') && init?.method === 'POST')
        return { status: 202, ok: true, json: async () => ({ id: 42 }) } as any;
      if (u.endsWith('/list'))
        return {
          status: 200,
          ok: true,
          json: async () => [{ id: 42, file_name: 'rep.csv' }],
        } as any;
      if (u.endsWith('/rep.csv'))
        return { status: 200, ok: true, text: async () => csv } as any;
      throw new Error('unexpected url ' + u);
    }) as any;
  });

  afterEach(() => {
    delete process.env.MP_ACCESS_TOKEN;
    jest.restoreAllMocks();
  });

  it('should import gastos, dedup, skip withdrawals and report ingresos', async () => {
    // mp-2 ya existe (dedup por externalId)
    (prisma.expense.findFirst as jest.Mock).mockImplementation(({ where }) =>
      where.externalId === 'mp:mp-2'
        ? Promise.resolve({ id: 'existing' })
        : Promise.resolve(null),
    );

    const s = await service.sync({
      from: '2026-08-04',
      to: '2026-08-05',
      pollIntervalMs: 1,
    });

    expect(s.imported).toBe(1);
    expect(prisma.expense.create).toHaveBeenCalledTimes(1);
    expect(prisma.expense.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId,
        amount: 15000,
        source: 'mercadopago',
        externalId: 'mp:mp-1',
        categoryId: 'cat-tr', // "Ausa peaje" → Transporte
      }),
    });
    expect(s.skipped).toBe(2); // dup + withdrawal
    expect(s.ingresosDetectados).toHaveLength(1);
    expect(prisma.mpSyncLog.create).toHaveBeenCalled();
  });

  it('should not write anything in dry-run mode', async () => {
    (prisma.expense.findFirst as jest.Mock).mockImplementation(({ where }) =>
      where.externalId === 'mp:mp-2'
        ? Promise.resolve({ id: 'existing' })
        : Promise.resolve(null),
    );

    const s = await service.sync({
      from: '2026-08-04',
      to: '2026-08-05',
      dryRun: true,
      pollIntervalMs: 1,
    });

    expect(s.imported).toBe(1); // lo que HUBIERA importado
    expect(prisma.expense.create).not.toHaveBeenCalled();
    expect(s.dryRun).toBe(true);
  });

  it('should skip gastos that look like manual duplicates (same date+amount)', async () => {
    (prisma.expense.findFirst as jest.Mock).mockImplementation(({ where }) =>
      where.externalId
        ? Promise.resolve(null)
        : Promise.resolve({ id: 'manual-dup', description: 'cargado a mano' }),
    );

    const s = await service.sync({
      from: '2026-08-04',
      to: '2026-08-05',
      pollIntervalMs: 1,
    });

    expect(s.imported).toBe(0);
    expect(prisma.expense.create).not.toHaveBeenCalled();
    expect(
      (s.detalles as any[]).some((d) => d.motivo?.includes('duplicado manual')),
    ).toBe(true);
  });

  it('should create the report config when the account has none (404)', async () => {
    const calls: string[] = [];
    (global.fetch as jest.Mock).mockImplementation(async (url: any, init?: any) => {
      const u = String(url);
      calls.push(`${init?.method || 'GET'} ${u}`);
      if (u.endsWith('/config') && (!init || init.method !== 'POST'))
        return { status: 404, ok: false, json: async () => ({}) } as any;
      if (u.endsWith('/config') && init?.method === 'POST')
        return { status: 201, ok: true, json: async () => ({}) } as any;
      if (u.endsWith('/settlement_report') && init?.method === 'POST')
        return { status: 202, ok: true, json: async () => ({ id: 42 }) } as any;
      if (u.endsWith('/list'))
        return {
          status: 200,
          ok: true,
          json: async () => [{ id: 42, file_name: 'rep.csv' }],
        } as any;
      if (u.endsWith('/rep.csv'))
        return { status: 200, ok: true, text: async () => csv } as any;
      throw new Error('unexpected url ' + u);
    });

    await service.sync({ from: '2026-08-04', to: '2026-08-05', pollIntervalMs: 1 });

    const configPost = calls.find((c) => c.startsWith('POST') && c.endsWith('/config'));
    expect(configPost).toBeDefined();
    // frequency es requerido por la API: sin él la config da 400
    const postCall = (global.fetch as jest.Mock).mock.calls.find(
      ([u, init]: any[]) =>
        String(u).endsWith('/config') && init?.method === 'POST',
    );
    expect(JSON.parse(postCall[1].body).frequency).toBeDefined();
  });

  it('should fail gracefully when MP_ACCESS_TOKEN is missing', async () => {
    delete process.env.MP_ACCESS_TOKEN;
    await expect(service.sync({ from: '2026-08-04', to: '2026-08-05' })).rejects.toThrow(
      /MP_ACCESS_TOKEN/,
    );
  });
});
