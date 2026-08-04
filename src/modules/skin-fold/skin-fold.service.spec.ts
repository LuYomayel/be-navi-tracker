import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { SkinFoldService } from './skin-fold.service';
import { PrismaService } from '../../config/prisma.service';
import { AICostService } from '../ai-cost/ai-cost.service';

describe('SkinFoldService', () => {
  let service: SkinFoldService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockRecord = {
    id: 'sf-1',
    userId,
    date: '2024-01-15',
    technician: 'Dr. Smith',
    notes: 'Regular measurement',
    values: { chest: 12, abdominal: 20, thigh: 15 },
    aiConfidence: null,
    pdfUrl: null,
    pdfFilename: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SkinFoldService,
        {
          provide: PrismaService,
          useValue: {
            skinFoldRecord: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: AICostService,
          useValue: {
            logFromCompletion: jest.fn(),
            calculateCost: jest.fn().mockReturnValue(0),
          },
        },
      ],
    }).compile();

    service = module.get<SkinFoldService>(SkinFoldService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getAll', () => {
    it('should return all records for user', async () => {
      (prisma.skinFoldRecord.findMany as jest.Mock).mockResolvedValue([
        mockRecord,
      ]);

      const result = await service.getAll(userId);

      expect(result).toHaveLength(1);
      expect(result[0].values).toEqual({ chest: 12, abdominal: 20, thigh: 15 });
    });
  });

  describe('getById', () => {
    it('should return a record by id', async () => {
      (prisma.skinFoldRecord.findFirst as jest.Mock).mockResolvedValue(
        mockRecord,
      );

      const result = await service.getById('sf-1', userId);

      expect(result.id).toBe('sf-1');
      expect(prisma.skinFoldRecord.findFirst).toHaveBeenCalledWith({
        where: { id: 'sf-1', userId },
      });
    });

    it('should throw NotFoundException when not found', async () => {
      (prisma.skinFoldRecord.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getById('nonexistent', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('should create a skin fold record', async () => {
      (prisma.skinFoldRecord.create as jest.Mock).mockResolvedValue(
        mockRecord,
      );

      const data = {
        date: '2024-01-15',
        technician: 'Dr. Smith',
        values: { chest: 12, abdominal: 20, thigh: 15 },
      };

      const result = await service.create(data as any, userId);

      expect(result).toBeDefined();
      expect(prisma.skinFoldRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ userId }),
        }),
      );
    });

    it('should reject when no measurements provided', async () => {
      const data = {
        date: '2024-01-15',
        values: {},
      };

      await expect(service.create(data as any, userId)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject values outside 0-50mm range', async () => {
      const data = {
        date: '2024-01-15',
        values: { chest: 60 },
      };

      await expect(service.create(data as any, userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('delete', () => {
    it('should delete a record', async () => {
      (prisma.skinFoldRecord.findFirst as jest.Mock).mockResolvedValue(
        mockRecord,
      );
      (prisma.skinFoldRecord.delete as jest.Mock).mockResolvedValue(
        mockRecord,
      );

      const result = await service.delete('sf-1', userId);

      expect(result).toBe(true);
    });

    it('should throw when record not found', async () => {
      (prisma.skinFoldRecord.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.delete('nonexistent', userId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('calculateBodyFatPercentage', () => {
    it('should calculate body fat for male (Jackson-Pollock 3-site)', () => {
      const values = { chest: 12, abdominal: 20, thigh: 15 };

      const result = service.calculateBodyFatPercentage(values, 30, 'male');

      expect(result).not.toBeNull();
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(40);
    });

    it('should calculate body fat for female (Jackson-Pollock 3-site)', () => {
      const values = { triceps: 18, suprailiac: 22, thigh: 25 };

      const result = service.calculateBodyFatPercentage(values, 28, 'female');

      expect(result).not.toBeNull();
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThan(50);
    });

    it('should return null when required sites are missing for male', () => {
      const values = { chest: 12, thigh: 15 }; // missing abdominal

      const result = service.calculateBodyFatPercentage(values, 30, 'male');

      expect(result).toBeNull();
    });

    it('should return null when required sites are missing for female', () => {
      const values = { triceps: 18, thigh: 25 }; // missing suprailiac

      const result = service.calculateBodyFatPercentage(values, 28, 'female');

      expect(result).toBeNull();
    });
  });

  describe('getStatistics', () => {
    it('should return statistics with frequency map', async () => {
      (prisma.skinFoldRecord.findMany as jest.Mock).mockResolvedValue([
        mockRecord,
        {
          ...mockRecord,
          id: 'sf-2',
          values: { chest: 11, abdominal: 19, thigh: 14, triceps: 10 },
        },
      ]);

      const result = await service.getStatistics(userId);

      expect(result.totalRecords).toBe(2);
      expect(result.latestRecord).toBeDefined();
      expect(result.sitesFrequency['chest']).toBe(2);
      expect(result.sitesFrequency['triceps']).toBe(1);
    });

    it('should return empty stats when no records', async () => {
      (prisma.skinFoldRecord.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getStatistics(userId);

      expect(result.totalRecords).toBe(0);
      expect(result.latestRecord).toBeUndefined();
    });
  });

  describe('analyzeAnthropometryPdf', () => {
    it('should throw when no images provided', async () => {
      await expect(
        service.analyzeAnthropometryPdf([], userId),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw when OpenAI is not configured', async () => {
      // Forzar openai=null: si el entorno tiene OPENAI_API_KEY (dev local con
      // .env) el constructor lo instancia y el test pegaría a la API real
      (service as any).openai = null;
      await expect(
        service.analyzeAnthropometryPdf(['base64data'], userId),
      ).rejects.toThrow(BadRequestException);
    });

    describe('with mocked OpenAI', () => {
      const fullAnalysisResponse = {
        basics: { weight: 82.4, height: 165, measurementDate: '2026-05-05' },
        skinFolds: {
          triceps: 6.5,
          subscapular: 12,
          supraspinal: 13,
          abdominal: 22.5,
          thigh: 16.5,
          calf: 12.5,
          sumOfSix: 83,
        },
        diameters: {},
        perimeters: {},
        bodyComposition: {},
        somatotype: { endomorphy: 3.3, mesomorphy: 8.6, ectomorphy: 0.1 },
        indexes: {},
        zScores: {},
      };

      let createMock: jest.Mock;

      beforeEach(() => {
        createMock = jest.fn().mockResolvedValue({
          choices: [
            { message: { content: JSON.stringify(fullAnalysisResponse) } },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 100 },
        });
        // Inyectar cliente OpenAI falso (el real solo se crea con env var)
        (service as any).openai = {
          chat: { completions: { create: createMock } },
        };
      });

      it('should map supraspinal to suprailiac and extract measurement date', async () => {
        const { record, fullAnalysis } = await service.analyzeAnthropometryPdf(
          ['base64data'],
          userId,
        );

        expect(record.values).toEqual({
          triceps: 6.5,
          subscapular: 12,
          suprailiac: 13,
          abdominal: 22.5,
          thigh: 16.5,
          calf: 12.5,
        });
        expect(record.date).toBe('2026-05-05');
        expect(record.technician).toBe('Extraído de PDF por IA');
        expect(fullAnalysis.somatotype.endomorphy).toBe(3.3);
      });

      it('should instruct the AI to use the "Posicionamiento actual" somatotype row', async () => {
        await service.analyzeAnthropometryPdf(['base64data'], userId);

        const prompt = createMock.mock.calls[0][0].messages[0].content[0].text;
        expect(prompt).toContain('Posicionamiento actual');
        expect(prompt).toContain('Posicionamiento anterior');
      });

      it('should instruct the AI to read body mass kg from the "Kg" column', async () => {
        await service.analyzeAnthropometryPdf(['base64data'], userId);

        const prompt = createMock.mock.calls[0][0].messages[0].content[0].text;
        expect(prompt).toMatch(/columna "Kg"/);
      });

      it('should instruct the AI to cross-check mass kg sum against total mass', async () => {
        await service.analyzeAnthropometryPdf(['base64data'], userId);

        const prompt = createMock.mock.calls[0][0].messages[0].content[0].text;
        expect(prompt).toContain('Masa Total');
        expect(prompt).toMatch(/suma de los kg/i);
      });

      it('should reconcile a misread mass kg using the weight identity', async () => {
        // Caso real: la IA leyó 42.653 en muscular pero la suma de las 5 masas
        // debe dar el peso (82.4). El % (51.44) delata cuál componente está mal.
        createMock.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...fullAnalysisResponse,
                  bodyComposition: {
                    adipose: { percentage: 21.18, kg: 17.484 },
                    muscular: { percentage: 51.44, kg: 42.653 },
                    residual: { percentage: 11.67, kg: 9.635 },
                    bone: { percentage: 11.18, kg: 9.095 },
                    skin: { percentage: 4.52, kg: 3.733 },
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 100 },
        });

        const { fullAnalysis } = await service.analyzeAnthropometryPdf(
          ['base64data'],
          userId,
        );

        expect(fullAnalysis.bodyComposition.muscular.kg).toBeCloseTo(42.453, 3);
        expect(fullAnalysis.bodyComposition.adipose.kg).toBeCloseTo(17.484, 3);
      });

      it('should leave body composition untouched when the kg sum matches the weight', async () => {
        createMock.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...fullAnalysisResponse,
                  bodyComposition: {
                    adipose: { percentage: 21.18, kg: 17.484 },
                    muscular: { percentage: 51.44, kg: 42.453 },
                    residual: { percentage: 11.67, kg: 9.635 },
                    bone: { percentage: 11.18, kg: 9.095 },
                    skin: { percentage: 4.52, kg: 3.733 },
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 100 },
        });

        const { fullAnalysis } = await service.analyzeAnthropometryPdf(
          ['base64data'],
          userId,
        );

        expect(fullAnalysis.bodyComposition.muscular.kg).toBe(42.453);
      });

      it('should skip reconciliation when body composition has nulls', async () => {
        createMock.mockResolvedValue({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  ...fullAnalysisResponse,
                  bodyComposition: {
                    adipose: { percentage: 21.18, kg: 17.484 },
                    muscular: { percentage: 51.44, kg: null },
                    residual: { percentage: 11.67, kg: 9.635 },
                    bone: { percentage: 11.18, kg: 9.095 },
                    skin: { percentage: 4.52, kg: 3.733 },
                  },
                }),
              },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 100 },
        });

        const { fullAnalysis } = await service.analyzeAnthropometryPdf(
          ['base64data'],
          userId,
        );

        expect(fullAnalysis.bodyComposition.muscular.kg).toBeNull();
        expect(fullAnalysis.bodyComposition.adipose.kg).toBe(17.484);
      });
    });
  });
});
