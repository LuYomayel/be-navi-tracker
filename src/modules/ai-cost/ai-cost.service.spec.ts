import { Test, TestingModule } from '@nestjs/testing';
import { AICostService } from './ai-cost.service';
import { PrismaService } from '../../config/prisma.service';

describe('AICostService', () => {
  let service: AICostService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockLog = {
    id: 'log-1',
    userId,
    service: 'analyze-food',
    model: 'gpt-4o',
    promptTokens: 1000,
    completionTokens: 500,
    totalTokens: 1500,
    costUsd: 0.0075,
    createdAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AICostService,
        {
          provide: PrismaService,
          useValue: {
            aICostLog: {
              create: jest.fn(),
              findMany: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<AICostService>(AICostService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('logCost', () => {
    it('should create a cost log entry', async () => {
      (prisma.aICostLog.create as jest.Mock).mockResolvedValue(mockLog);

      const data = {
        userId,
        service: 'analyze-food',
        model: 'gpt-4o',
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
        costUsd: 0.0075,
      };

      const result = await service.logCost(data);

      expect(result).toBeDefined();
      expect(prisma.aICostLog.create).toHaveBeenCalledWith({ data });
    });
  });

  describe('getStats', () => {
    it('should calculate cost statistics', async () => {
      const logs = [
        { ...mockLog, service: 'analyze-food', costUsd: 0.005 },
        { ...mockLog, id: 'log-2', service: 'analyze-food', costUsd: 0.003 },
        {
          ...mockLog,
          id: 'log-3',
          service: 'body-analysis',
          costUsd: 0.01,
        },
      ];
      (prisma.aICostLog.findMany as jest.Mock).mockResolvedValue(logs);

      const result = await service.getStats(userId);

      expect(result.totalCost).toBe(0.018);
      expect(result.totalCalls).toBe(3);
      expect(result.byService['analyze-food'].calls).toBe(2);
      expect(result.byService['analyze-food'].cost).toBe(0.008);
      expect(result.byService['body-analysis'].calls).toBe(1);
    });

    it('should return zeros when no logs', async () => {
      (prisma.aICostLog.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getStats(userId);

      expect(result.totalCost).toBe(0);
      expect(result.totalCalls).toBe(0);
      expect(result.byService).toEqual({});
      expect(result.recentLogs).toEqual([]);
    });

    it('should calculate monthly cost from last 30 days', async () => {
      const recentLog = {
        ...mockLog,
        costUsd: 0.01,
        createdAt: new Date(),
      };
      const oldLog = {
        ...mockLog,
        id: 'log-old',
        costUsd: 0.05,
        createdAt: new Date('2020-01-01'),
      };
      (prisma.aICostLog.findMany as jest.Mock).mockResolvedValue([
        recentLog,
        oldLog,
      ]);

      const result = await service.getStats(userId);

      expect(result.totalCost).toBe(0.06);
      expect(result.monthlyCost).toBe(0.01);
    });

    it('should limit recent logs to 20', async () => {
      const manyLogs = Array.from({ length: 25 }, (_, i) => ({
        ...mockLog,
        id: `log-${i}`,
        costUsd: 0.001,
      }));
      (prisma.aICostLog.findMany as jest.Mock).mockResolvedValue(manyLogs);

      const result = await service.getStats(userId);

      expect(result.recentLogs).toHaveLength(20);
    });
  });
});
