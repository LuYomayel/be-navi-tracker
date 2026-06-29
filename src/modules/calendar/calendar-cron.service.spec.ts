import { CalendarCronService } from './calendar-cron.service';
import { GoogleCalendarService } from './google-calendar.service';

describe('CalendarCronService', () => {
  let service: CalendarCronService;
  let googleCalendar: { syncAllConnections: jest.Mock };

  beforeEach(() => {
    googleCalendar = { syncAllConnections: jest.fn() };
    service = new CalendarCronService(
      googleCalendar as unknown as GoogleCalendarService,
    );
  });

  it('dispara syncAllConnections en el cron', async () => {
    googleCalendar.syncAllConnections.mockResolvedValue({
      total: 1,
      ok: 1,
      failed: 0,
    });

    await service.syncGoogleCalendars();

    expect(googleCalendar.syncAllConnections).toHaveBeenCalledTimes(1);
  });

  it('no propaga errores del sync (best-effort)', async () => {
    googleCalendar.syncAllConnections.mockRejectedValue(new Error('boom'));

    await expect(service.syncGoogleCalendars()).resolves.toBeUndefined();
  });
});
