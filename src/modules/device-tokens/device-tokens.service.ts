import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';

/**
 * Guarda y administra los tokens de push de los dispositivos del usuario.
 * Un token es unico globalmente; si se re-registra bajo otro usuario, se
 * reasigna (un device pertenece al ultimo usuario logueado).
 */
@Injectable()
export class DeviceTokensService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, token: string, platform: string) {
    return this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform },
    });
  }

  async remove(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
    return { success: true };
  }

  async getTokensForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.deviceToken.findMany({
      where: { userId },
      select: { token: true },
    });
    return rows.map((r) => r.token);
  }

  /** Borra tokens invalidos (reportados por FCM como no registrados). */
  async pruneTokens(tokens: string[]) {
    if (!tokens.length) return;
    await this.prisma.deviceToken.deleteMany({
      where: { token: { in: tokens } },
    });
  }
}
