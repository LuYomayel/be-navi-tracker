import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^[a-z0-9_-]{1,40}$/;
const MAX_VALUE = 999;

/**
 * Contadores diarios genéricos (ej. "ventas-mensajes": cuántos mensajes de
 * venta mandé hoy). Un valor entero por usuario + día + key.
 */
@Injectable()
export class CountersService {
  constructor(private readonly prisma: PrismaService) {}

  async getDay(userId: string, date: string): Promise<Record<string, number>> {
    this.checkDate(date);
    const rows = await this.prisma.dailyCounter.findMany({
      where: { userId, date },
      select: { key: true, value: true },
    });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async adjust(userId: string, date: string, key: string, delta: number) {
    this.checkDate(date);
    if (!KEY_RE.test(key ?? '')) {
      throw new BadRequestException('key inválida (a-z, 0-9, - y _)');
    }
    if (!Number.isInteger(delta)) {
      throw new BadRequestException('delta tiene que ser un entero');
    }
    const current = await this.prisma.dailyCounter.findUnique({
      where: { userId_date_key: { userId, date, key } },
      select: { value: true },
    });
    const value = Math.min(MAX_VALUE, Math.max(0, (current?.value ?? 0) + delta));
    return this.prisma.dailyCounter.upsert({
      where: { userId_date_key: { userId, date, key } },
      create: { userId, date, key, value },
      update: { value },
      select: { key: true, value: true },
    });
  }

  private checkDate(date: string) {
    if (!DATE_RE.test(date ?? '')) {
      throw new BadRequestException('date tiene que ser YYYY-MM-DD');
    }
  }
}
