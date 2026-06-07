import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { BriefingService } from './briefing.service';

/**
 * Cron del briefing diario: 07:00 hora Argentina. Genera + persiste + manda el
 * mail para cada usuario activo con email. Equivalente al briefing matutino que
 * antes hacia el asistente personal (cowork), ahora nativo en NaviTracker.
 */
@Injectable()
export class BriefingCronService {
  private readonly logger = new Logger(BriefingCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly briefing: BriefingService,
  ) {}

  @Cron('0 7 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async dailyBriefing() {
    this.logger.log('Generando briefings diarios (07:00 ART)...');
    const users = await this.prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, email: true },
    });
    for (const u of users) {
      try {
        const { emailSent } = await this.briefing.generateAndSend(u.id);
        this.logger.log(
          `Briefing ${u.email}: persistido${emailSent ? ' + mail enviado' : ' (sin mail)'}`,
        );
      } catch (err) {
        this.logger.error(
          `Briefing fallo para ${u.id}: ${(err as Error).message}`,
        );
      }
    }
  }
}
