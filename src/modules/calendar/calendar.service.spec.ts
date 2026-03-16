import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CalendarService } from './calendar.service';
import { PrismaService } from '../../config/prisma.service';

describe('CalendarService', () => {
  let service: CalendarService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockEvent = {
    id: 'event-1',
    userId,
    title: 'Meeting',
    description: 'Team standup',
    location: 'Office',
    startTime: new Date('2026-03-16T10:00:00'),
    endTime: new Date('2026-03-16T11:00:00'),
    allDay: false,
    color: '#3b82f6',
    source: 'manual',
    googleEventId: null,
    createdAt: new Date('2026-03-16'),
    updatedAt: new Date('2026-03-16'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CalendarService,
        {
          provide: PrismaService,
          useValue: {
            calendarEvent: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<CalendarService>(CalendarService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  describe('getEvents', () => {
    it('should return events for a date range', async () => {
      (prisma.calendarEvent.findMany as jest.Mock).mockResolvedValue([
        mockEvent,
      ]);

      const result = await service.getEvents(userId, '2026-03-16', '2026-03-16');

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Meeting');
      expect(prisma.calendarEvent.findMany).toHaveBeenCalledWith({
        where: {
          userId,
          startTime: { gte: new Date('2026-03-16T00:00:00') },
          endTime: { lte: new Date('2026-03-16T23:59:59') },
        },
        orderBy: { startTime: 'asc' },
      });
    });

    it('should return empty array when no events', async () => {
      (prisma.calendarEvent.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getEvents(userId, '2026-03-16', '2026-03-16');

      expect(result).toEqual([]);
    });
  });

  describe('createEvent', () => {
    it('should create a manual event', async () => {
      (prisma.calendarEvent.create as jest.Mock).mockResolvedValue(mockEvent);

      const result = await service.createEvent(userId, {
        title: 'Meeting',
        startTime: '2026-03-16T10:00:00',
        endTime: '2026-03-16T11:00:00',
        description: 'Team standup',
        location: 'Office',
        allDay: false,
        color: '#3b82f6',
      });

      expect(result.title).toBe('Meeting');
      expect(prisma.calendarEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          title: 'Meeting',
          source: 'manual',
          allDay: false,
        }),
      });
    });

    it('should default allDay to false', async () => {
      (prisma.calendarEvent.create as jest.Mock).mockResolvedValue(mockEvent);

      await service.createEvent(userId, {
        title: 'Event',
        startTime: '2026-03-16T10:00:00',
        endTime: '2026-03-16T11:00:00',
      });

      expect(prisma.calendarEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          allDay: false,
        }),
      });
    });
  });

  describe('updateEvent', () => {
    it('should update an event', async () => {
      (prisma.calendarEvent.findFirst as jest.Mock).mockResolvedValue(mockEvent);
      (prisma.calendarEvent.update as jest.Mock).mockResolvedValue({
        ...mockEvent,
        title: 'Updated meeting',
      });

      const result = await service.updateEvent(userId, 'event-1', {
        title: 'Updated meeting',
      });

      expect(result.title).toBe('Updated meeting');
    });

    it('should convert string dates to Date objects', async () => {
      (prisma.calendarEvent.findFirst as jest.Mock).mockResolvedValue(mockEvent);
      (prisma.calendarEvent.update as jest.Mock).mockResolvedValue(mockEvent);

      await service.updateEvent(userId, 'event-1', {
        startTime: '2026-03-16T14:00:00',
        endTime: '2026-03-16T15:00:00',
      });

      expect(prisma.calendarEvent.update).toHaveBeenCalledWith({
        where: { id: 'event-1' },
        data: expect.objectContaining({
          startTime: expect.any(Date),
          endTime: expect.any(Date),
        }),
      });
    });

    it('should throw NotFoundException if event not found', async () => {
      (prisma.calendarEvent.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateEvent(userId, 'non-existent', { title: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should enforce ownership', async () => {
      (prisma.calendarEvent.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateEvent('other-user', 'event-1', { title: 'x' }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.calendarEvent.findFirst).toHaveBeenCalledWith({
        where: { id: 'event-1', userId: 'other-user' },
      });
    });
  });

  describe('deleteEvent', () => {
    it('should delete an event', async () => {
      (prisma.calendarEvent.findFirst as jest.Mock).mockResolvedValue(mockEvent);
      (prisma.calendarEvent.delete as jest.Mock).mockResolvedValue(mockEvent);

      const result = await service.deleteEvent(userId, 'event-1');

      expect(result).toEqual({ deleted: true });
      expect(prisma.calendarEvent.delete).toHaveBeenCalledWith({
        where: { id: 'event-1' },
      });
    });

    it('should throw NotFoundException if event not found', async () => {
      (prisma.calendarEvent.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.deleteEvent(userId, 'non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
