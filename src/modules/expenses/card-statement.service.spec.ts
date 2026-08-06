import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CardStatementService } from './card-statement.service';
import { ExpenseCategorizerService } from './expense-categorizer.service';
import { PrismaService } from '../../config/prisma.service';
import { AICostService } from '../ai-cost/ai-cost.service';

describe('CardStatementService', () => {
  let service: CardStatementService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const parsedStatement = {
    bank: 'ICBC',
    cardLabel: 'Visa Classic',
    closingDate: '2026-07-30',
    dueDate: '2026-08-11',
    totalArs: 362378.28,
    totalUsd: 2.99,
    movements: [
      {
        date: '2026-07-07',
        description: 'SPOTIFY',
        amountArs: 8413.47,
        installment: null,
        isTax: false,
      },
      {
        date: '2026-05-12',
        description: 'MERPAGO*GRID',
        amountArs: 10499.83,
        installment: '3/6',
        isTax: false,
      },
      {
        date: '2026-07-30',
        description: 'IVA RG 4240',
        amountArs: 6272.91,
        installment: null,
        isTax: true,
      },
    ],
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CardStatementService,
        {
          provide: ExpenseCategorizerService,
          useValue: {
            categorize: jest.fn().mockImplementation((_u: string, d: string) =>
              d.includes('SPOTIFY')
                ? Promise.resolve({
                    categoryId: 'c-sub',
                    categoryName: 'Suscripciones',
                    source: 'reglas',
                    confidence: 0.95,
                  })
                : Promise.resolve(null),
            ),
          },
        },
        {
          provide: PrismaService,
          useValue: {
            expense: {
              findFirst: jest.fn().mockResolvedValue(null),
              deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'new', ...data }),
              ),
            },
          },
        },
        { provide: AICostService, useValue: { logFromCompletion: jest.fn() } },
      ],
    }).compile();

    service = module.get(CardStatementService);
    prisma = module.get(PrismaService);
  });

  describe('parseStatement', () => {
    it('should parse pages with Vision, suggest categories and flag duplicates', async () => {
      (service as any).openai = {
        chat: {
          completions: {
            create: jest.fn().mockResolvedValue({
              choices: [
                { message: { content: JSON.stringify(parsedStatement) } },
              ],
              usage: { prompt_tokens: 1000, completion_tokens: 300 },
            }),
          },
        },
      };
      // El de Spotify ya existe con mismo monto ese mes (duplicado probable)
      (prisma.expense.findFirst as jest.Mock).mockImplementation(({ where }) =>
        where.amount === 8413.47
          ? Promise.resolve({ id: 'dup', description: 'Spotify (7/7)' })
          : Promise.resolve(null),
      );

      const r = await service.parseStatement(userId, ['img1', 'img2']);

      expect(r.bank).toBe('ICBC');
      expect(r.movements).toHaveLength(3);
      const spotify = r.movements.find((m) => m.description === 'SPOTIFY')!;
      expect(spotify.categoria).toBe('Suscripciones');
      expect(spotify.categoryId).toBe('c-sub');
      expect(spotify.duplicate).toBe(true);
      const grid = r.movements.find((m) => m.description === 'MERPAGO*GRID')!;
      expect(grid.duplicate).toBe(false);
      expect(grid.installment).toBe('3/6');
    });

    it('should reject when there are no images', async () => {
      (service as any).openai = {};
      await expect(service.parseStatement(userId, [])).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject when OpenAI is not configured', async () => {
      (service as any).openai = null;
      await expect(service.parseStatement(userId, ['x'])).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('confirmImport', () => {
    const movements = [
      {
        date: '2026-07-07',
        description: 'SPOTIFY',
        amount: 8413.47,
        categoryId: 'c-sub',
      },
      { date: '2026-05-12', description: 'MERPAGO*GRID (cuota 3/6)', amount: 10499.83 },
    ];

    it('should create expenses dated on the due date with dedup externalIds', async () => {
      const r = await service.confirmImport(userId, {
        statementKey: 'icbc-2026-07-30',
        dueDate: '2026-08-11',
        movements,
      });

      expect(r.imported).toBe(2);
      expect(prisma.expense.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          date: '2026-08-11',
          amount: 8413.47,
          description: 'SPOTIFY - Visa (consumo 2026-07-07)',
          categoryId: 'c-sub',
          source: 'tarjeta',
          externalId: 'card:icbc-2026-07-30:0',
        }),
      });
    });

    it('should skip rows already imported (externalId) or matching an existing expense', async () => {
      (prisma.expense.findFirst as jest.Mock).mockImplementation(({ where }) =>
        where.externalId === 'card:icbc-2026-07-30:0' ||
        where.amount === 10499.83
          ? Promise.resolve({ id: 'existing' })
          : Promise.resolve(null),
      );

      const r = await service.confirmImport(userId, {
        statementKey: 'icbc-2026-07-30',
        dueDate: '2026-08-11',
        movements,
      });

      expect(r.imported).toBe(0);
      expect(r.skipped).toBe(2);
      expect(prisma.expense.create).not.toHaveBeenCalled();
    });
  });
});
