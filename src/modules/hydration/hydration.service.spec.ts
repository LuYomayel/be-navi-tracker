import { Test, TestingModule } from '@nestjs/testing';
import { HydrationService } from './hydration.service';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';

describe('HydrationService', () => {
  let service: HydrationService;
  let prisma: PrismaService;
  let xpService: XpService;

  const userId = 'user-1';

  const mockHydrationLog = {
    id: 'hydration-1',
    userId,
    date: '2026-03-16',
    glassesConsumed: 5,
    mlConsumed: 1250,
    goalReachedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HydrationService,
        {
          provide: PrismaService,
          useValue: {
            hydrationLog: {
              findUnique: jest.fn(),
              findMany: jest.fn(),
              upsert: jest.fn(),
              update: jest.fn(),
            },
            userPreferences: {
              findFirst: jest.fn(),
              upsert: jest.fn(),
            },
            physicalActivity: {
              findFirst: jest.fn(),
            },
          },
        },
        {
          provide: XpService,
          useValue: {
            addXp: jest.fn().mockResolvedValue({
              newLevel: 1,
              xpEarned: 20,
              totalXpEarned: 20,
              leveledUp: false,
            }),
          },
        },
      ],
    }).compile();

    service = module.get<HydrationService>(HydrationService);
    prisma = module.get<PrismaService>(PrismaService);
    xpService = module.get<XpService>(XpService);
  });

  // ═══════════════════════════════════════════════════════════
  // getByDate
  // ═══════════════════════════════════════════════════════════

  describe('getByDate', () => {
    it('should return log when it exists', async () => {
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue(mockHydrationLog);

      const result = await service.getByDate(userId, '2026-03-16');

      expect(result).toEqual(mockHydrationLog);
      expect(prisma.hydrationLog.findUnique).toHaveBeenCalledWith({
        where: { userId_date: { userId, date: '2026-03-16' } },
      });
    });

    it('should return default zeroes when no log exists', async () => {
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getByDate(userId, '2026-03-16');

      expect(result).toEqual({
        userId,
        date: '2026-03-16',
        glassesConsumed: 0,
        mlConsumed: 0,
        goalReachedAt: null,
      });
    });
  });

  // ═══════════════════════════════════════════════════════════
  // getRange
  // ═══════════════════════════════════════════════════════════

  describe('getRange', () => {
    it('should return logs in date range ordered by date', async () => {
      const logs = [mockHydrationLog, { ...mockHydrationLog, date: '2026-03-17' }];
      (prisma.hydrationLog.findMany as jest.Mock).mockResolvedValue(logs);

      const result = await service.getRange(userId, '2026-03-16', '2026-03-22');

      expect(result).toEqual(logs);
      expect(prisma.hydrationLog.findMany).toHaveBeenCalledWith({
        where: { userId, date: { gte: '2026-03-16', lte: '2026-03-22' } },
        orderBy: { date: 'asc' },
      });
    });

    it('should return empty array when no logs in range', async () => {
      (prisma.hydrationLog.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getRange(userId, '2026-01-01', '2026-01-07');

      expect(result).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // adjust
  // ═══════════════════════════════════════════════════════════

  describe('adjust', () => {
    beforeEach(() => {
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue(null); // defaults: 8 glasses, 250ml
    });

    it('should increment glasses by delta', async () => {
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue(mockHydrationLog); // 5 glasses
      const upsertedLog = { ...mockHydrationLog, glassesConsumed: 6, mlConsumed: 1500 };
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue(upsertedLog);

      const result = await service.adjust(userId, { date: '2026-03-16', delta: 1 });

      expect(result.glassesConsumed).toBe(6);
      expect(prisma.hydrationLog.upsert).toHaveBeenCalledWith({
        where: { userId_date: { userId, date: '2026-03-16' } },
        create: { userId, date: '2026-03-16', glassesConsumed: 6, mlConsumed: 1500 },
        update: { glassesConsumed: 6, mlConsumed: 1500 },
      });
    });

    it('should decrement glasses by negative delta', async () => {
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue(mockHydrationLog); // 5 glasses
      const upsertedLog = { ...mockHydrationLog, glassesConsumed: 4, mlConsumed: 1000 };
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue(upsertedLog);

      const result = await service.adjust(userId, { date: '2026-03-16', delta: -1 });

      expect(result.glassesConsumed).toBe(4);
    });

    it('should clamp to 0 when decrementing below zero', async () => {
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue({
        ...mockHydrationLog,
        glassesConsumed: 0,
      });
      const upsertedLog = { ...mockHydrationLog, glassesConsumed: 0, mlConsumed: 0 };
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue(upsertedLog);

      await service.adjust(userId, { date: '2026-03-16', delta: -1 });

      expect(prisma.hydrationLog.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ glassesConsumed: 0 }),
        }),
      );
    });

    it('should clamp to 30 when incrementing above max', async () => {
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue({
        ...mockHydrationLog,
        glassesConsumed: 30,
      });
      const upsertedLog = { ...mockHydrationLog, glassesConsumed: 30, mlConsumed: 7500 };
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue(upsertedLog);

      await service.adjust(userId, { date: '2026-03-16', delta: 1 });

      expect(prisma.hydrationLog.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ glassesConsumed: 30 }),
        }),
      );
    });

    it('should create new log when none exists', async () => {
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue(null);
      const upsertedLog = { ...mockHydrationLog, glassesConsumed: 1, mlConsumed: 250 };
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue(upsertedLog);

      await service.adjust(userId, { date: '2026-03-16', delta: 1 });

      expect(prisma.hydrationLog.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ glassesConsumed: 1, mlConsumed: 250 }),
        }),
      );
    });

    it('should award XP when goal is reached for the first time', async () => {
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue({
        ...mockHydrationLog,
        glassesConsumed: 7,
      });
      const upsertedLog = {
        ...mockHydrationLog,
        id: 'hydration-1',
        glassesConsumed: 8,
        mlConsumed: 2000,
        goalReachedAt: null, // not reached yet
      };
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue(upsertedLog);

      await service.adjust(userId, { date: '2026-03-16', delta: 1 });

      expect(prisma.hydrationLog.update).toHaveBeenCalledWith({
        where: { id: 'hydration-1' },
        data: { goalReachedAt: expect.any(Date) },
      });
      expect(xpService.addXp).toHaveBeenCalledWith(userId, {
        action: 'hydration_goal',
        xpAmount: 20,
        description: 'Meta de hidratacion alcanzada: 2026-03-16',
        metadata: { date: '2026-03-16', glasses: 8 },
      });
    });

    it('should NOT award XP when goal was already reached', async () => {
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue({
        ...mockHydrationLog,
        glassesConsumed: 8,
      });
      const upsertedLog = {
        ...mockHydrationLog,
        glassesConsumed: 9,
        mlConsumed: 2250,
        goalReachedAt: new Date(), // already reached
      };
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue(upsertedLog);

      await service.adjust(userId, { date: '2026-03-16', delta: 1 });

      expect(prisma.hydrationLog.update).not.toHaveBeenCalled();
      expect(xpService.addXp).not.toHaveBeenCalled();
    });

    it('should use custom ml per glass from preferences', async () => {
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue({
        hydrationGoalGlasses: 6,
        hydrationMlPerGlass: 500,
      });
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue(null);
      const upsertedLog = { ...mockHydrationLog, glassesConsumed: 1, mlConsumed: 500 };
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue(upsertedLog);

      await service.adjust(userId, { date: '2026-03-16', delta: 1 });

      expect(prisma.hydrationLog.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ mlConsumed: 500 }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // set
  // ═══════════════════════════════════════════════════════════

  describe('set', () => {
    beforeEach(() => {
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue(null);
    });

    it('should set absolute glasses value', async () => {
      const upsertedLog = { ...mockHydrationLog, glassesConsumed: 10, mlConsumed: 2500 };
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue(upsertedLog);

      const result = await service.set(userId, { date: '2026-03-16', glasses: 10 });

      expect(result.glassesConsumed).toBe(10);
    });

    it('should clamp to [0, 30]', async () => {
      const upsertedLog = { ...mockHydrationLog, glassesConsumed: 30, mlConsumed: 7500 };
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue(upsertedLog);

      await service.set(userId, { date: '2026-03-16', glasses: 50 });

      expect(prisma.hydrationLog.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ glassesConsumed: 30 }),
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════
  // getGoal / setGoal
  // ═══════════════════════════════════════════════════════════

  describe('getGoal', () => {
    it('should return goal from preferences', async () => {
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue({
        hydrationGoalGlasses: 10,
        hydrationMlPerGlass: 300,
      });

      const result = await service.getGoal(userId);

      expect(result).toEqual({ goalGlasses: 10, mlPerGlass: 300 });
    });

    it('should return defaults when no preferences exist', async () => {
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getGoal(userId);

      expect(result).toEqual({ goalGlasses: 8, mlPerGlass: 250 });
    });
  });

  describe('setGoal', () => {
    it('should upsert user preferences with goal', async () => {
      (prisma.userPreferences.upsert as jest.Mock).mockResolvedValue({});

      const result = await service.setGoal(userId, { goalGlasses: 12, mlPerGlass: 200 });

      expect(result).toEqual({ goalGlasses: 12, mlPerGlass: 200 });
      expect(prisma.userPreferences.upsert).toHaveBeenCalledWith({
        where: { userId },
        create: { userId, hydrationGoalGlasses: 12, hydrationMlPerGlass: 200 },
        update: { hydrationGoalGlasses: 12, hydrationMlPerGlass: 200 },
      });
    });
  });

  describe('getPace (hidratacion por tramos)', () => {
    beforeEach(() => {
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue({
        hydrationBlocks: null, // sin configurar → defaults
        hydrationGoalGlasses: 8,
        hydrationMlPerGlass: 250,
      });
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue({
        id: 'log-1',
        userId: 'user-1',
        date: '2026-08-04',
        glassesConsumed: 2,
        mlConsumed: 500,
        trainingDay: null,
        goalReachedAt: null,
      });
      (prisma.physicalActivity.findFirst as jest.Mock).mockResolvedValue(null);
    });

    it('usa los tramos default y calcula el ritmo a las 10:00', async () => {
      const pace = await service.getPace('user-1', '2026-08-04', 600); // 10:00
      expect(pace.currentBlock?.id).toBe('morning');
      expect(pace.expectedByNowMl).toBe(500);
      expect(pace.deficitMl).toBe(0); // tomó 500, va a ritmo
      expect(pace.trainingActive).toBe(false);
      expect(pace.totalTargetMl).toBe(2000);
    });

    it('activa el tramo de entrenamiento si hay actividad fisica registrada', async () => {
      (prisma.physicalActivity.findFirst as jest.Mock).mockResolvedValue({
        id: 'act-1',
      });
      const pace = await service.getPace('user-1', '2026-08-04', 600);
      expect(pace.trainingActive).toBe(true);
      expect(pace.totalTargetMl).toBe(3500);
    });

    it('el toggle manual trainingDay=false gana sobre la actividad registrada', async () => {
      (prisma.physicalActivity.findFirst as jest.Mock).mockResolvedValue({
        id: 'act-1',
      });
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue({
        id: 'log-1',
        date: '2026-08-04',
        mlConsumed: 500,
        glassesConsumed: 2,
        trainingDay: false,
        goalReachedAt: null,
      });
      const pace = await service.getPace('user-1', '2026-08-04', 600);
      expect(pace.trainingActive).toBe(false);
    });

    it('usa los tramos configurados del usuario cuando existen', async () => {
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue({
        hydrationBlocks: [
          { id: 'a', label: 'Unico', start: '08:00', end: '20:00', targetMl: 3000 },
        ],
      });
      const pace = await service.getPace('user-1', '2026-08-04', 840); // 14:00
      expect(pace.totalTargetMl).toBe(3000);
      expect(pace.expectedByNowMl).toBe(1500); // mitad del tramo
    });

    it('un dia pasado se evalua con el dia completo, sin prorratear por la hora actual', async () => {
      const pace = await service.getPace('user-1', '2020-01-01');
      expect(pace.expectedByNowMl).toBe(2000); // todos los tramos activos, completos
      expect(pace.deficitMl).toBe(1500); // tomo 500 de 2000
      expect(pace.currentBlock).toBeNull();
    });

    it('un dia futuro arranca con expectativa cero', async () => {
      const pace = await service.getPace('user-1', '2099-01-01');
      expect(pace.expectedByNowMl).toBe(0);
      expect(pace.deficitMl).toBe(0);
    });
  });

  describe('setBlocks', () => {
    it('valida y persiste los tramos', async () => {
      (prisma.userPreferences.upsert as jest.Mock).mockResolvedValue({});
      const blocks = [
        { id: 'm', label: 'Mañana', start: '07:00', end: '13:00', targetMl: 1000 },
      ];
      await service.setBlocks('user-1', blocks as any);
      expect(prisma.userPreferences.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          update: { hydrationBlocks: blocks },
        }),
      );
    });

    it('rechaza tramos invalidos', async () => {
      await expect(
        service.setBlocks('user-1', [
          { id: 'x', label: 'X', start: '14:00', end: '13:00', targetMl: 500 },
        ] as any),
      ).rejects.toThrow();
      expect(prisma.userPreferences.upsert).not.toHaveBeenCalled();
    });
  });

  describe('setTrainingToday', () => {
    it('upsertea el flag del dia', async () => {
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue({
        id: 'log-1',
        trainingDay: true,
      });
      await service.setTrainingToday('user-1', '2026-08-04', true);
      expect(prisma.hydrationLog.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_date: { userId: 'user-1', date: '2026-08-04' } },
          update: { trainingDay: true },
        }),
      );
    });
  });

  describe('XP con tramos configurados', () => {
    it('otorga XP al llegar a la suma de tramos activos (sin entreno: 2000ml)', async () => {
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue({
        hydrationBlocks: [
          { id: 'm', label: 'Mañana', start: '07:00', end: '13:00', targetMl: 1000 },
          { id: 't', label: 'Tarde', start: '13:00', end: '20:00', targetMl: 1000 },
          { id: 'e', label: 'Entreno', start: '18:00', end: '23:00', targetMl: 1500, requiresTraining: true },
        ],
        hydrationGoalGlasses: 8,
        hydrationMlPerGlass: 250,
      });
      (prisma.physicalActivity.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue({
        id: 'log-1',
        date: '2026-08-04',
        glassesConsumed: 8,
        mlConsumed: 2000,
        trainingDay: null,
        goalReachedAt: null,
      });
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.hydrationLog.update as jest.Mock).mockResolvedValue({});

      await service.adjust('user-1', { date: '2026-08-04', delta: 1 });

      expect(xpService.addXp).toHaveBeenCalledWith(
        'user-1',
        expect.objectContaining({ xpAmount: 20 }),
      );
    });

    it('con entreno activo NO otorga XP a los 2000ml (meta 3500)', async () => {
      (prisma.userPreferences.findFirst as jest.Mock).mockResolvedValue({
        hydrationBlocks: [
          { id: 'm', label: 'Mañana', start: '07:00', end: '13:00', targetMl: 1000 },
          { id: 't', label: 'Tarde', start: '13:00', end: '20:00', targetMl: 1000 },
          { id: 'e', label: 'Entreno', start: '18:00', end: '23:00', targetMl: 1500, requiresTraining: true },
        ],
        hydrationGoalGlasses: 8,
        hydrationMlPerGlass: 250,
      });
      (prisma.physicalActivity.findFirst as jest.Mock).mockResolvedValue({ id: 'act-1' });
      (prisma.hydrationLog.upsert as jest.Mock).mockResolvedValue({
        id: 'log-1',
        date: '2026-08-04',
        glassesConsumed: 8,
        mlConsumed: 2000,
        trainingDay: null,
        goalReachedAt: null,
      });
      (prisma.hydrationLog.findUnique as jest.Mock).mockResolvedValue(null);

      await service.adjust('user-1', { date: '2026-08-04', delta: 1 });

      expect(xpService.addXp).not.toHaveBeenCalled();
    });
  });
});
