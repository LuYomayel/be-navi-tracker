import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import {
  SleepService,
  parseDuration,
  parseClock,
  minutesBetween,
} from './sleep.service';
import { PrismaService } from '../../config/prisma.service';
import { XpService } from '../xp/xp.service';

describe('SleepService', () => {
  let service: SleepService;
  let prisma: PrismaService;
  let xp: XpService;

  const userId = 'user-1';
  const mockLog = {
    id: 'sleep-1',
    userId,
    date: '2026-08-06',
    minutesAsleep: 465,
    bedTime: '23:15',
    wakeTime: '07:00',
    quality: 4,
    deepMinutes: 70,
    remMinutes: 95,
    awakeMinutes: 15,
    heartRateAvg: 52,
    source: 'shortcut',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SleepService,
        {
          provide: PrismaService,
          useValue: {
            sleepLog: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              upsert: jest.fn().mockResolvedValue(mockLog),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
        {
          provide: XpService,
          useValue: { addXp: jest.fn().mockResolvedValue({}) },
        },
      ],
    }).compile();

    service = module.get(SleepService);
    prisma = module.get(PrismaService);
    xp = module.get(XpService);
  });

  describe('parseDuration', () => {
    it('should accept minutes as a number', () => {
      expect(parseDuration(465)).toBe(465);
    });

    it('should parse what the Apple Shortcut sends ("7:45", "7h 45m", "7,75")', () => {
      expect(parseDuration('7:45')).toBe(465);
      expect(parseDuration('7h 45m')).toBe(465);
      expect(parseDuration('7 h')).toBe(420);
      // horas decimales (el atajo puede mandar 7,75 o 7.75)
      expect(parseDuration('7,75')).toBe(465);
      expect(parseDuration('7.75')).toBe(465);
    });

    it('should treat a bare small number as hours and a big one as minutes', () => {
      expect(parseDuration('8')).toBe(480);
      expect(parseDuration('465')).toBe(465);
    });

    it('should return null for junk', () => {
      expect(parseDuration('anoche dormí mal')).toBeNull();
      expect(parseDuration('')).toBeNull();
      expect(parseDuration(undefined)).toBeNull();
    });
  });

  describe('parseClock', () => {
    it('should take HH:mm as is', () => {
      expect(parseClock('23:15')).toBe('23:15');
      expect(parseClock('7:00')).toBe('07:00');
    });

    it('should take what the Shortcut passes as a date', () => {
      // el atajo puede pegar la fecha entera de la muestra de Health
      expect(parseClock('2026-08-06T07:03:00-03:00')).toBe('07:03');
      expect(parseClock('6 ago 2026 23:12')).toBe('23:12');
      expect(parseClock('11:30 p. m.')).toBe('23:30');
      expect(parseClock('7:05 a. m.')).toBe('07:05');
    });

    it('should return null when there is no time in there', () => {
      expect(parseClock('anoche')).toBeNull();
      expect(parseClock(undefined)).toBeNull();
    });
  });

  describe('minutesBetween', () => {
    it('should measure the night crossing midnight', () => {
      expect(minutesBetween('23:15', '07:00')).toBe(465);
      expect(minutesBetween('01:00', '08:30')).toBe(450);
    });

    it('should work with the raw dates of the Health sample', () => {
      expect(
        minutesBetween('2026-08-05T23:15:00-03:00', '2026-08-06T07:00:00-03:00'),
      ).toBe(465);
    });

    it('should return null if a time is missing or unreadable', () => {
      expect(minutesBetween('23:15', undefined)).toBeNull();
      expect(minutesBetween('cualquiera', '07:00')).toBeNull();
    });
  });

  describe('upsertSleep', () => {
    it('should upsert by day so re-running the shortcut does not duplicate', async () => {
      await service.upsertSleep(userId, {
        date: '2026-08-06',
        minutesAsleep: 465,
        bedTime: '23:15',
        wakeTime: '07:00',
        source: 'shortcut',
      });

      expect(prisma.sleepLog.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_date: { userId, date: '2026-08-06' } },
        }),
      );
    });

    it('should reject a duration that is not real sleep', async () => {
      await expect(
        service.upsertSleep(userId, { date: '2026-08-06', minutesAsleep: 0 }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.upsertSleep(userId, {
          date: '2026-08-06',
          minutesAsleep: 60 * 25,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should award XP only the first time in the day', async () => {
      (prisma.sleepLog.findUnique as jest.Mock).mockResolvedValue(null);
      await service.upsertSleep(userId, {
        date: '2026-08-06',
        minutesAsleep: 465,
      });
      expect(xp.addXp).toHaveBeenCalled();

      (xp.addXp as jest.Mock).mockClear();
      (prisma.sleepLog.findUnique as jest.Mock).mockResolvedValue(mockLog);
      await service.upsertSleep(userId, {
        date: '2026-08-06',
        minutesAsleep: 470,
      });
      expect(xp.addXp).not.toHaveBeenCalled();
    });
  });

  describe('getStats', () => {
    it('should average the last nights and report the trend vs the previous week', async () => {
      (prisma.sleepLog.findMany as jest.Mock).mockResolvedValue([
        { ...mockLog, date: '2026-08-06', minutesAsleep: 480, quality: 4 },
        { ...mockLog, date: '2026-08-05', minutesAsleep: 420, quality: 3 },
        { ...mockLog, date: '2026-08-04', minutesAsleep: 450, quality: 5 },
      ]);

      const stats = await service.getStats(userId, 7);

      expect(stats.noches).toBe(3);
      expect(stats.promedioMinutos).toBe(450); // (480+420+450)/3
      expect(stats.promedioTexto).toBe('7h 30m');
      expect(stats.calidadPromedio).toBe(4);
      expect(stats.mejorNoche?.minutesAsleep).toBe(480);
      expect(stats.peorNoche?.minutesAsleep).toBe(420);
    });

    it('should handle no data', async () => {
      (prisma.sleepLog.findMany as jest.Mock).mockResolvedValue([]);
      const stats = await service.getStats(userId, 7);
      expect(stats.noches).toBe(0);
      expect(stats.promedioMinutos).toBe(0);
    });
  });
});
