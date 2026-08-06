import { Test, TestingModule } from '@nestjs/testing';
import {
  ExpenseCategorizerService,
  matchCategoryByRules,
  normalizeDescription,
} from './expense-categorizer.service';
import { PrismaService } from '../../config/prisma.service';
import { AICostService } from '../ai-cost/ai-cost.service';

describe('matchCategoryByRules', () => {
  it('should map merchants to canonical category names', () => {
    expect(matchCategoryByRules('Ausa - pago de peaje')).toBe('Transporte');
    expect(matchCategoryByRules("Mcdonald's pago en tienda (MP)")).toBe('Comida');
    expect(matchCategoryByRules('Meli+ - pago automático')).toBe('Suscripciones');
    expect(matchCategoryByRules('Coto sucursal 22')).toBe('Supermercado');
    expect(matchCategoryByRules('Farmacity Palermo')).toBe('Salud');
    expect(matchCategoryByRules('Cuota del club de handball')).toBe('Deporte');
    expect(matchCategoryByRules('Filamento PLA Bambu')).toBe('Impresión 3D');
    expect(matchCategoryByRules('Seguros La Meridional - Visa ICBC')).toBe('Transporte');
    expect(matchCategoryByRules('Tuenti recargas')).toBe('Hogar');
    expect(matchCategoryByRules('Zapatillas - MP GRID (cuota 4/6)')).toBe('Ropa');
    expect(matchCategoryByRules('Transferencia a Juan')).toBeNull();
  });
});

describe('normalizeDescription', () => {
  it('should strip MP suffixes and transfer prefixes', () => {
    expect(normalizeDescription('Transferencia a Camila Bazan (MP)')).toBe(
      'camila bazan',
    );
    expect(normalizeDescription('SETTLEMENT (MP)')).toBe('settlement');
    expect(normalizeDescription('  Kiosco  ')).toBe('kiosco');
  });
});

describe('ExpenseCategorizerService', () => {
  let service: ExpenseCategorizerService;
  let prisma: PrismaService;

  const userId = 'user-1';
  const cats = [
    { id: 'c-tr', name: 'Transporte' },
    { id: 'c-sa', name: 'Salud' },
    { id: 'c-ot', name: 'Otros' },
  ];

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpenseCategorizerService,
        {
          provide: PrismaService,
          useValue: {
            expenseCategory: { findMany: jest.fn().mockResolvedValue(cats) },
            expense: {
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              update: jest.fn().mockResolvedValue({}),
            },
          },
        },
        { provide: AICostService, useValue: { logFromCompletion: jest.fn() } },
      ],
    }).compile();

    service = module.get(ExpenseCategorizerService);
    prisma = module.get(PrismaService);
    (service as any).openai = null; // sin IA salvo que el test la setee
  });

  describe('categorize', () => {
    it('should match by rules first (free, no AI)', async () => {
      const r = await service.categorize(userId, 'Peaje Ausa (MP)');
      expect(r).toMatchObject({
        categoryId: 'c-tr',
        categoryName: 'Transporte',
        source: 'reglas',
      });
    });

    it('should reuse the category of a similar past expense (historial)', async () => {
      (prisma.expense.findFirst as jest.Mock).mockResolvedValue({
        id: 'old',
        categoryId: 'c-sa',
        description: 'Transferencia a Camila Bazan (MP)',
      });

      const r = await service.categorize(
        userId,
        'Transferencia a Camila Bazan (MP)',
      );

      expect(r).toMatchObject({ categoryId: 'c-sa', source: 'historial' });
      expect(prisma.expense.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId,
            categoryId: { not: null },
            description: { contains: 'camila bazan' },
          }),
        }),
      );
    });

    it('should fall back to AI and respect the confidence threshold', async () => {
      (service as any).openai = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [
                { message: { content: '{"category": "Salud", "confidence": 0.85}' } },
              ],
              usage: { prompt_tokens: 50, completion_tokens: 10 },
            }),
          },
        },
      };

      const r = await service.categorize(userId, 'Turno con la dermatóloga');
      expect(r).toMatchObject({ categoryId: 'c-sa', source: 'ia' });
    });

    it('should return null when AI is unsure (low confidence)', async () => {
      (service as any).openai = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [
                { message: { content: '{"category": "Otros", "confidence": 0.3}' } },
              ],
              usage: { prompt_tokens: 50, completion_tokens: 10 },
            }),
          },
        },
      };

      const r = await service.categorize(userId, 'Transferencia a Fulano');
      expect(r).toBeNull();
    });

    it('should return null when the user has no categories', async () => {
      (prisma.expenseCategory.findMany as jest.Mock).mockResolvedValue([]);
      const r = await service.categorize(userId, 'Peaje Ausa');
      expect(r).toBeNull();
    });
  });

  describe('backfill', () => {
    it('should categorize uncategorized expenses and update them', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([
        { id: 'e1', description: 'Peaje Ausa (MP)', amount: 994, date: '2026-08-04' },
        { id: 'e2', description: 'Transferencia a Fulano', amount: 100, date: '2026-08-03' },
      ]);

      const r = await service.backfill(userId, {});

      expect(r.procesados).toBe(2);
      expect(r.categorizados).toBe(1); // solo el peaje (reglas); Fulano queda sin
      expect(prisma.expense.update).toHaveBeenCalledTimes(1);
      expect(prisma.expense.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { categoryId: 'c-tr' },
      });
    });

    it('should not write anything in dry-run', async () => {
      (prisma.expense.findMany as jest.Mock).mockResolvedValue([
        { id: 'e1', description: 'Peaje Ausa (MP)', amount: 994, date: '2026-08-04' },
      ]);

      const r = await service.backfill(userId, { dryRun: true });

      expect(r.categorizados).toBe(1);
      expect(prisma.expense.update).not.toHaveBeenCalled();
    });
  });
});
