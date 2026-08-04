import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { HydrationService } from './hydration.service';
import { PushService } from '../device-tokens/push.service';

/**
 * Recordatorios graduales de hidratación por tramos (server push).
 * Cada 45 min entre las 08 y las 22 ART: si el usuario viene ≥1 vaso abajo
 * del ritmo del tramo actual, se le manda un push con lo que le falta.
 * Degrada con gracia: sin FIREBASE_SERVICE_ACCOUNT_BASE64 el PushService
 * no envía (las notificaciones locales del dispositivo cubren mientras tanto).
 */
@Injectable()
export class HydrationCronService {
  private readonly logger = new Logger(HydrationCronService.name);

  constructor(
    private prisma: PrismaService,
    private hydration: HydrationService,
    private push: PushService,
  ) {}

  @Cron('0,45 8-22 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async remindHydrationPace() {
    try {
      // Solo usuarios con dispositivos registrados (sin token no hay a quién avisar)
      const tokens = await this.prisma.deviceToken.findMany({
        select: { userId: true },
        distinct: ['userId'],
      });
      for (const { userId } of tokens) {
        try {
          const pace = await this.hydration.getPace(userId);
          if (!pace.currentBlock || pace.deficitMl < pace.mlPerGlass) continue;
          const glasses = Math.ceil(pace.deficitMl / pace.mlPerGlass);
          await this.push.sendToUser(userId, {
            title: `💧 ${pace.currentBlock.label}: te falta agua`,
            body: `Vas ${pace.deficitMl}ml abajo del ritmo — tomate ${glasses} vaso${glasses > 1 ? 's' : ''} (${pace.consumedMl}ml de ${pace.totalTargetMl}ml del día).`,
          });
        } catch (error) {
          this.logger.warn(`Pace/push falló para ${userId}: ${error}`);
        }
      }
    } catch (error) {
      this.logger.error('Error en recordatorios de hidratación:', error);
    }
  }
}
