import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrintingService } from './printing.service';
import { PrismaService } from '../../config/prisma.service';
import { GoalService } from '../goal/goal.service';
import { SettlementService } from './settlement.service';

describe('PrintingService', () => {
  let service: PrintingService;
  let prisma: any;
  let goal: any;

  const userId = 'user-1';

  const mockSettings = {
    id: 'settings-1',
    userId,
    costPerGram: 20,
    wastePct: 0.15,
    powerPerHour: 12,
    defaultMarkup: 1.3,
    publicToken: 'token-abc',
    financingSurcharge: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockProduct = {
    id: 'prod-1',
    userId,
    name: 'Rompecabezas de numeros 1-10',
    author: 'Dprintas',
    makerworldUrl: 'https://makerworld.com/es/models/1215273',
    grams: 127,
    hours: 4.5,
    colorsLabel: '1',
    sizeMm: '165x165x6',
    licenseOk: false,
    markupOverride: null,
    publicPrice: 11000,
    active: true,
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrintingService,
        SettlementService,
        {
          provide: PrismaService,
          useValue: {
            printSettings: {
              findUnique: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
            },
            printProduct: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            filament: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            printSale: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            printSaleSettlement: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            expense: {
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            income: {
              create: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: GoalService,
          useValue: {
            getActive: jest.fn().mockResolvedValue(null),
          },
        },
      ],
    }).compile();

    service = module.get<PrintingService>(PrintingService);
    prisma = module.get(PrismaService);
    goal = module.get(GoalService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Settings ────────────────────────────────────────────────
  describe('getSettings', () => {
    it('crea la fila con defaults + token si el usuario no tiene settings todavia', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(null);
      prisma.printSettings.create.mockResolvedValue(mockSettings);

      const result = await service.getSettings(userId);

      expect(prisma.printSettings.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            publicToken: expect.any(String),
          }),
        }),
      );
      expect(result).toEqual(mockSettings);
    });

    it('devuelve las settings existentes sin crear de nuevo', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);

      const result = await service.getSettings(userId);

      expect(prisma.printSettings.create).not.toHaveBeenCalled();
      expect(result).toEqual(mockSettings);
    });
  });

  describe('updateSettings', () => {
    it('actualiza los parametros de costeo', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      prisma.printSettings.update.mockResolvedValue({
        ...mockSettings,
        costPerGram: 25,
      });

      const result = await service.updateSettings(userId, { costPerGram: 25 });

      expect(prisma.printSettings.update).toHaveBeenCalledWith({
        where: { userId },
        data: expect.objectContaining({ costPerGram: 25 }),
      });
      expect(result.costPerGram).toBe(25);
    });

    it('rechaza wastePct negativo', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      await expect(
        service.updateSettings(userId, { wastePct: -0.1 }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('regenerateToken', () => {
    it('genera un token nuevo distinto del anterior', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      prisma.printSettings.update.mockImplementation(({ data }) =>
        Promise.resolve({ ...mockSettings, ...data }),
      );

      const result = await service.regenerateToken(userId);

      expect(result.publicToken).not.toBe(mockSettings.publicToken);
    });
  });

  // ── Productos ───────────────────────────────────────────────
  describe('getProducts', () => {
    it('devuelve productos con costo/precio/ganancia calculados en vivo', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      prisma.printProduct.findMany.mockResolvedValue([mockProduct]);

      const [result] = await service.getProducts(userId);

      // costo = (127*20)*1.15 + 4.5*12 = 2975 -> 3000
      expect(result.cost).toBe(3000);
      // precio = 3000 * 1.3 = 3900
      expect(result.priceToMarcelito).toBe(3900);
      expect(result.profit).toBe(900);
    });

    it('usa el markupOverride del producto si esta seteado', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      const tetris = {
        ...mockProduct,
        id: 'prod-8',
        grams: 494,
        hours: 14.3,
        markupOverride: 1.5,
      };
      prisma.printProduct.findMany.mockResolvedValue([tetris]);

      const [result] = await service.getProducts(userId);

      expect(result.cost).toBe(11500);
      expect(result.priceToMarcelito).toBe(17300);
      expect(result.profit).toBe(5800);
    });
  });

  describe('createProduct', () => {
    it('crea un producto valido', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      prisma.printProduct.create.mockResolvedValue({
        ...mockProduct,
        photos: [],
      });
      const result = await service.createProduct(userId, {
        name: mockProduct.name,
        author: mockProduct.author,
        grams: 127,
        hours: 4.5,
        colorsLabel: '1',
      });
      expect(result).toMatchObject(mockProduct);
    });

    // Regresion: el POST devolvia el objeto crudo de Prisma, sin cost/
    // priceToMarcelito/profit. El front mete esa respuesta en el estado tal
    // cual (usePrinting.ts createProduct) => la card mostraba "$NaN" hasta
    // recargar. Ver getProducts: el GET si los calcula.
    it('devuelve el producto con el pricing ya calculado', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      prisma.printProduct.create.mockResolvedValue({
        ...mockProduct,
        photos: [],
      });
      const result = await service.createProduct(userId, {
        name: mockProduct.name,
        grams: 127,
        hours: 4.5,
        colorsLabel: '1',
      });
      expect(result.cost).toBe(3000);
      expect(result.priceToMarcelito).toBe(3900);
      expect(result.profit).toBe(900);
      expect(result.photos).toEqual([]);
    });

    it('rechaza sin nombre', async () => {
      await expect(
        service.createProduct(userId, {
          name: '',
          grams: 100,
          hours: 1,
          colorsLabel: '1',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza gramos <= 0', async () => {
      await expect(
        service.createProduct(userId, {
          name: 'x',
          grams: 0,
          hours: 1,
          colorsLabel: '1',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateProduct / deleteProduct', () => {
    it('404 si el producto no es del usuario', async () => {
      prisma.printProduct.findFirst.mockResolvedValue(null);
      await expect(
        service.updateProduct(userId, 'nope', { name: 'x' }),
      ).rejects.toThrow(NotFoundException);
      await expect(service.deleteProduct(userId, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('actualiza un producto propio', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      prisma.printProduct.findFirst.mockResolvedValue(mockProduct);
      prisma.printProduct.update.mockResolvedValue({
        ...mockProduct,
        active: false,
        photos: [],
      });
      const result = await service.updateProduct(userId, mockProduct.id, {
        active: false,
      });
      expect(result.active).toBe(false);
    });

    // Regresion: mismo caso que el POST (ver createProduct). Editar un
    // producto dejaba la card en "$NaN" y sin la foto hasta recargar.
    it('devuelve el producto actualizado con el pricing recalculado', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      prisma.printProduct.findFirst.mockResolvedValue(mockProduct);
      prisma.printProduct.update.mockResolvedValue({
        ...mockProduct,
        grams: 494,
        hours: 14.3,
        markupOverride: 1.5,
        photos: [],
      });
      const result = await service.updateProduct(userId, mockProduct.id, {
        grams: 494,
        hours: 14.3,
        markupOverride: 1.5,
      });
      expect(result.cost).toBe(11500);
      expect(result.priceToMarcelito).toBe(17300);
      expect(result.profit).toBe(5800);
    });
  });

  // ── Filamentos ──────────────────────────────────────────────
  describe('createFilament', () => {
    it('deriva pricePerGram y crea un Expense linkeado sin objetivo activo', async () => {
      goal.getActive.mockResolvedValue(null);
      prisma.expense.create.mockResolvedValue({ id: 'exp-1' });
      prisma.filament.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'fil-1', ...data }),
      );

      const result = await service.createFilament(userId, {
        brand: 'Bambu Lab',
        material: 'PLA Lite',
        color: 'Rojo',
        pricePaid: 19969,
        purchasedAt: '2026-07-27',
        notes: 'sin carrete',
      });

      expect(result.pricePerGram).toBeCloseTo(19969 / 1000);
      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            amount: 19969,
            source: 'printing',
            goalId: null,
          }),
        }),
      );
      expect(result.expenseId).toBe('exp-1');
    });

    it('linkea el goalId del objetivo activo como snapshot', async () => {
      goal.getActive.mockResolvedValue({ id: 'goal-nz' });
      prisma.expense.create.mockResolvedValue({ id: 'exp-2' });
      prisma.filament.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'fil-2', ...data }),
      );

      await service.createFilament(userId, {
        brand: 'Bambu',
        material: 'PLA',
        color: 'Negro',
        pricePaid: 20000,
        grams: 1000,
        purchasedAt: '2026-08-01',
      });

      expect(prisma.expense.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ goalId: 'goal-nz' }),
        }),
      );
    });

    it('rechaza pricePaid <= 0', async () => {
      await expect(
        service.createFilament(userId, {
          brand: 'x',
          material: 'y',
          color: 'z',
          pricePaid: 0,
          purchasedAt: '2026-08-01',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('deleteFilament', () => {
    it('borra el filamento y su Expense linkeado', async () => {
      prisma.filament.findFirst.mockResolvedValue({
        id: 'fil-1',
        userId,
        expenseId: 'exp-1',
      });
      prisma.filament.delete.mockResolvedValue({});
      prisma.expense.delete.mockResolvedValue({});

      await service.deleteFilament(userId, 'fil-1');

      expect(prisma.expense.delete).toHaveBeenCalledWith({
        where: { id: 'exp-1' },
      });
      expect(prisma.filament.delete).toHaveBeenCalledWith({
        where: { id: 'fil-1' },
      });
    });

    it('404 si no es del usuario', async () => {
      prisma.filament.findFirst.mockResolvedValue(null);
      await expect(service.deleteFilament(userId, 'nope')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── Ventas ──────────────────────────────────────────────────
  describe('createSale', () => {
    it('snapshotea costo y precio del producto si no se pasan explicitos', async () => {
      prisma.printProduct.findFirst.mockResolvedValue(mockProduct);
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      prisma.printSale.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'sale-1', ...data }),
      );

      const result = await service.createSale(userId, {
        date: '2026-08-01',
        productId: mockProduct.id,
        kind: 'venta',
        qty: 2,
      });

      expect(result.costUnit).toBe(3000);
      expect(result.chargedUnit).toBe(3900);
      expect(result.status).toBe('a_liquidar');
    });

    it('una muestra fuerza chargedUnit a 0', async () => {
      prisma.printProduct.findFirst.mockResolvedValue(mockProduct);
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      prisma.printSale.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'sale-2', ...data }),
      );

      const result = await service.createSale(userId, {
        date: '2026-08-01',
        productId: mockProduct.id,
        kind: 'muestra',
        chargedUnit: 999, // se ignora
      });

      expect(result.chargedUnit).toBe(0);
    });

    it('404 si el producto no existe o no es del usuario', async () => {
      prisma.printProduct.findFirst.mockResolvedValue(null);
      await expect(
        service.createSale(userId, {
          date: '2026-08-01',
          productId: 'nope',
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── Resumen / balance ───────────────────────────────────────
  describe('getSummary', () => {
    // Escenario real de la migracion (corrige los errores de la planilla)
    const filaments = [
      { pricePaid: 19969 },
      { pricePaid: 19969 },
      { pricePaid: 19969 },
      { pricePaid: 16946 }, // GST3D descartado, sigue contando como invertido
      { pricePaid: 20572 },
      { pricePaid: 26279 },
      { pricePaid: 21839 },
      { pricePaid: 21839 },
    ];

    const sales = [
      // 3 muestras
      { kind: 'muestra', qty: 1, chargedUnit: 0, costUnit: 5700, status: 'a_liquidar' },
      { kind: 'muestra', qty: 1, chargedUnit: 0, costUnit: 3000, status: 'a_liquidar' },
      { kind: 'muestra', qty: 1, chargedUnit: 0, costUnit: 11500, status: 'a_liquidar' },
      // 2 ventas de TETRIS x2, a liquidar
      { kind: 'venta', qty: 2, chargedUnit: 17300, costUnit: 11500, status: 'a_liquidar' },
      { kind: 'venta', qty: 2, chargedUnit: 17300, costUnit: 11500, status: 'a_liquidar' },
    ];

    beforeEach(() => {
      prisma.filament.findMany.mockResolvedValue(filaments);
      prisma.printSale.findMany.mockResolvedValue(sales);
      prisma.printSettings.findUnique.mockResolvedValue({
        ...mockSettings,
        financingSurcharge: 11776,
      });
    });

    it('la ganancia de ventas es 23200 (la planilla sumaba solo una venta y daba 11600)', async () => {
      const summary = await service.getSummary(userId);
      expect(summary.profitSalesTotal).toBe(23200);
    });

    it('el resultado contra las muestras da +3000 (la planilla decia -8600)', async () => {
      const summary = await service.getSummary(userId);
      expect(summary.investedSamples).toBe(20200);
      expect(summary.result).toBe(3000);
    });

    it('invertido en filamento suma los rollos + el recargo de financiacion (aparte, no prorrateado)', async () => {
      const summary = await service.getSummary(userId);
      const sumaRollos = filaments.reduce((a, f) => a + f.pricePaid, 0);
      expect(summary.investedFilament).toBe(sumaRollos + 11776);
    });

    it('calcula cuanto falta para cubrir el filamento contra la ganancia bruta de ventas', async () => {
      const summary = await service.getSummary(userId);
      const sumaRollos = filaments.reduce((a, f) => a + f.pricePaid, 0);
      const investedFilament = sumaRollos + 11776;
      expect(summary.missingToCoverFilament).toBe(
        Math.max(0, investedFilament - summary.profitSalesTotal),
      );
    });

    it('sin ventas ni filamentos, el resumen no explota (funciona con el modulo vacio)', async () => {
      prisma.filament.findMany.mockResolvedValue([]);
      prisma.printSale.findMany.mockResolvedValue([]);
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);

      const summary = await service.getSummary(userId);

      expect(summary.investedFilament).toBe(0);
      expect(summary.profitSalesTotal).toBe(0);
      expect(summary.result).toBe(0);
      expect(summary.missingToCoverFilament).toBe(0);
    });
  });

  // ── Catalogo publico ────────────────────────────────────────
  describe('getPublicCatalog', () => {
    const licensedProduct = {
      ...mockProduct,
      id: 'prod-8',
      name: 'TETRIS de equilibrio',
      licenseOk: true,
      markupOverride: 1.5,
      grams: 494,
      hours: 14.3,
      publicPrice: 30000,
    };

    it('devuelve los productos activos, sin datos internos de Luciano', async () => {
      // El catalogo publico REEMPLAZA al sheet que Marcelito ya tiene con 11
      // productos: filtrar por licencia lo dejaria con 2 y le romperia la
      // feria. La licencia es un aviso INTERNO (ver el catalogo de Luciano).
      prisma.printSettings.findUnique.mockResolvedValue(mockSettings);
      prisma.printProduct.findMany.mockResolvedValue([licensedProduct]);

      const result = await service.getPublicCatalog(mockSettings.publicToken);

      expect(prisma.printProduct.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId,
            active: true,
          }),
        }),
      );
      expect(
        (prisma.printProduct.findMany as jest.Mock).mock.calls[0][0].where
          .licenseOk,
      ).toBeUndefined();
      expect(result).toHaveLength(1);
      const item = result[0];
      // Campos permitidos
      expect(item.name).toBe('TETRIS de equilibrio');
      expect(item.colorsLabel).toBeDefined();
      expect(item.sizeMm).toBeDefined();
      expect(item.makerworldUrl).toBeDefined();
      expect(item.priceToMarcelito).toBe(17300); // lo que le cuesta a Marcelito
      expect(item.publicPrice).toBe(30000); // precio sugerido de venta
      expect(item.marcelitoProfit).toBe(30000 - 17300); // su ganancia revendiendo

      // Campos PROHIBIDOS: nunca el costo real ni la ganancia de Luciano,
      // ni gramos/horas, ni filamentos. Ademas de que TS no los tipa en el
      // objeto devuelto (compile-time), lo chequeamos tambien en runtime.
      const raw = item as any;
      expect(raw.cost).toBeUndefined();
      expect(raw.costUnit).toBeUndefined();
      expect(raw.profit).toBeUndefined();
      expect(raw.grams).toBeUndefined();
      expect(raw.hours).toBeUndefined();
      expect(raw.filaments).toBeUndefined();
      expect(raw.markupOverride).toBeUndefined();
      expect(raw.userId).toBeUndefined();
    });

    it('404 con un token invalido', async () => {
      prisma.printSettings.findUnique.mockResolvedValue(null);
      await expect(service.getPublicCatalog('token-invalido')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
