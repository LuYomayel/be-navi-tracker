import { Test, TestingModule } from '@nestjs/testing';
import { BodyAnalysisService } from './body-analysis.service';
import { PrismaService } from '../../config/prisma.service';
import { AICostService } from '../ai-cost/ai-cost.service';

/**
 * Los analisis corporales son datos de salud: cada lectura y cada escritura
 * tiene que estar filtrada por el userId del token, nunca por el del body.
 */
describe('BodyAnalysisService', () => {
  let service: BodyAnalysisService;
  let prisma: PrismaService;

  const userId = 'user-1';
  const otroUserId = 'user-2';

  const mockAnalysis = {
    id: 'ba-1',
    userId,
    bodyType: 'mesomorph',
    measurements: {},
    bodyComposition: {},
    recommendations: {},
    progress: {},
    insights: [],
    disclaimer: '',
    aiConfidence: 0.8,
    createdAt: new Date('2024-01-15'),
    updatedAt: new Date('2024-01-15'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BodyAnalysisService,
        {
          provide: PrismaService,
          useValue: {
            bodyAnalysis: {
              findMany: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              updateMany: jest.fn(),
              delete: jest.fn(),
              deleteMany: jest.fn(),
            },
          },
        },
        {
          provide: AICostService,
          useValue: { logFromCompletion: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<BodyAnalysisService>(BodyAnalysisService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getAll', () => {
    it('solo trae los analisis del usuario', async () => {
      (prisma.bodyAnalysis.findMany as jest.Mock).mockResolvedValue([
        mockAnalysis,
      ]);

      const result = await service.getAll(userId);

      expect(result).toHaveLength(1);
      expect(prisma.bodyAnalysis.findMany).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('devuelve [] ante un error', async () => {
      (prisma.bodyAnalysis.findMany as jest.Mock).mockRejectedValue(
        new Error('DB error'),
      );

      expect(await service.getAll(userId)).toEqual([]);
    });
  });

  describe('getById', () => {
    it('filtra por dueño', async () => {
      (prisma.bodyAnalysis.findFirst as jest.Mock).mockResolvedValue(
        mockAnalysis,
      );

      const result = await service.getById('ba-1', userId);

      expect(result).toEqual(mockAnalysis);
      expect(prisma.bodyAnalysis.findFirst).toHaveBeenCalledWith({
        where: { id: 'ba-1', userId },
      });
    });

    it('devuelve null si el analisis es de otro usuario', async () => {
      (prisma.bodyAnalysis.findFirst as jest.Mock).mockResolvedValue(null);

      expect(await service.getById('ba-1', otroUserId)).toBeNull();
    });
  });

  describe('getLatest', () => {
    it('filtra por dueño', async () => {
      (prisma.bodyAnalysis.findFirst as jest.Mock).mockResolvedValue(
        mockAnalysis,
      );

      await service.getLatest(userId);

      expect(prisma.bodyAnalysis.findFirst).toHaveBeenCalledWith({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('getRecentAnalyses', () => {
    it('filtra por dueño ademas de por fecha', async () => {
      (prisma.bodyAnalysis.findMany as jest.Mock).mockResolvedValue([]);

      await service.getRecentAnalyses(30, userId);

      const call = (prisma.bodyAnalysis.findMany as jest.Mock).mock.calls[0][0];
      expect(call.where.userId).toBe(userId);
      expect(call.where.createdAt.gte).toBeInstanceOf(Date);
    });
  });

  describe('update', () => {
    it('actualiza un analisis propio', async () => {
      (prisma.bodyAnalysis.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.bodyAnalysis.findFirst as jest.Mock).mockResolvedValue({
        ...mockAnalysis,
        bodyType: 'ectomorph',
      });

      const result = await service.update(
        'ba-1',
        { bodyType: 'ectomorph' } as any,
        userId,
      );

      expect(result).not.toBeNull();
      expect(prisma.bodyAnalysis.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'ba-1', userId } }),
      );
    });

    it('nunca reasigna el userId desde el body', async () => {
      (prisma.bodyAnalysis.updateMany as jest.Mock).mockResolvedValue({
        count: 1,
      });
      (prisma.bodyAnalysis.findFirst as jest.Mock).mockResolvedValue(
        mockAnalysis,
      );

      await service.update(
        'ba-1',
        { bodyType: 'ectomorph', userId: otroUserId } as any,
        userId,
      );

      const call = (prisma.bodyAnalysis.updateMany as jest.Mock).mock
        .calls[0][0];
      expect(call.data.userId).toBeUndefined();
    });

    it('devuelve null si el analisis es de otro usuario', async () => {
      (prisma.bodyAnalysis.updateMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      const result = await service.update(
        'ba-1',
        { bodyType: 'ectomorph' } as any,
        otroUserId,
      );

      expect(result).toBeNull();
      expect(prisma.bodyAnalysis.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('borra solo si es del usuario', async () => {
      (prisma.bodyAnalysis.deleteMany as jest.Mock).mockResolvedValue({
        count: 1,
      });

      expect(await service.delete('ba-1', userId)).toBe(true);
      expect(prisma.bodyAnalysis.deleteMany).toHaveBeenCalledWith({
        where: { id: 'ba-1', userId },
      });
    });

    it('devuelve false si el analisis es de otro usuario', async () => {
      (prisma.bodyAnalysis.deleteMany as jest.Mock).mockResolvedValue({
        count: 0,
      });

      expect(await service.delete('ba-1', otroUserId)).toBe(false);
    });
  });
});
