import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { GoogleCalendarService } from './google-calendar.service';

/**
 * Cron de sincronizacion de Google Calendar.
 *
 * La sync de Google solo corria al conectar la cuenta o a mano desde la app,
 * asi que el briefing matutino (07:00) siempre encontraba la agenda vacia.
 * Este cron sincroniza todas las conexiones cada hora y, sobre todo, a las
 * 06:45 ART para que el briefing de las 07:00 tenga los eventos del dia frescos.
 * Es best-effort: un fallo en una conexion no rompe el cron.
 */
@Injectable()
export class CalendarCronService {
  private readonly logger = new Logger(CalendarCronService.name);

  constructor(private readonly googleCalendar: GoogleCalendarService) {}

  @Cron('45 6 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async syncBeforeBriefing() {
    await this.syncGoogleCalendars();
  }

  @Cron('0 * * * *')
  async syncHourly() {
    await this.syncGoogleCalendars();
  }

  /** Dispara la sync de todas las conexiones, sin propagar errores. */
  async syncGoogleCalendars(): Promise<void> {
    try {
      const { total, ok, failed } =
        await this.googleCalendar.syncAllConnections();
      if (total > 0) {
        this.logger.log(
          `Sync Google Calendar: ${ok}/${total} ok${failed ? `, ${failed} con error` : ''}.`,
        );
      }
    } catch (err) {
      this.logger.error(
        `Sync Google Calendar fallo: ${(err as Error).message}`,
      );
    }
  }
}
