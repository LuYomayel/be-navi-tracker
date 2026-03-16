import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';

@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  async getEvents(userId: string, from: string, to: string) {
    const startDate = new Date(from + 'T00:00:00');
    const endDate = new Date(to + 'T23:59:59');

    const events = await this.prisma.calendarEvent.findMany({
      where: {
        userId,
        startTime: { gte: startDate },
        endTime: { lte: endDate },
      },
      orderBy: { startTime: 'asc' },
    });

    return events;
  }

  async createEvent(userId: string, dto: CreateEventDto) {
    const event = await this.prisma.calendarEvent.create({
      data: {
        userId,
        title: dto.title,
        description: dto.description,
        location: dto.location,
        startTime: new Date(dto.startTime),
        endTime: new Date(dto.endTime),
        allDay: dto.allDay || false,
        color: dto.color,
        source: 'manual',
      },
    });
    return event;
  }

  async updateEvent(userId: string, id: string, dto: UpdateEventDto) {
    const existing = await this.prisma.calendarEvent.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Event not found');

    const data: any = { ...dto };
    if (dto.startTime) data.startTime = new Date(dto.startTime);
    if (dto.endTime) data.endTime = new Date(dto.endTime);

    const event = await this.prisma.calendarEvent.update({
      where: { id },
      data,
    });
    return event;
  }

  async deleteEvent(userId: string, id: string) {
    const existing = await this.prisma.calendarEvent.findFirst({
      where: { id, userId },
    });
    if (!existing) throw new NotFoundException('Event not found');

    await this.prisma.calendarEvent.delete({ where: { id } });
    return { deleted: true };
  }
}
