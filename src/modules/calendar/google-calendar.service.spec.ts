import { GoogleCalendarService } from './google-calendar.service';
import { PrismaService } from '../../config/prisma.service';

describe('GoogleCalendarService.syncAllConnections', () => {
  let service: GoogleCalendarService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      googleCalendarConnection: {
        findMany: jest.fn(),
      },
    };
    service = new GoogleCalendarService(prisma as PrismaService);
  });

  it('sincroniza cada conexion y cuenta los exitos', async () => {
    prisma.googleCalendarConnection.findMany.mockResolvedValue([
      { userId: 'u1' },
      { userId: 'u2' },
    ]);
    const syncSpy = jest
      .spyOn(service, 'sync')
      .mockResolvedValue({ synced: 3 } as any);

    const result = await service.syncAllConnections();

    expect(syncSpy).toHaveBeenCalledTimes(2);
    expect(syncSpy).toHaveBeenCalledWith('u1');
    expect(syncSpy).toHaveBeenCalledWith('u2');
    expect(result).toEqual({ total: 2, ok: 2, failed: 0 });
  });

  it('si una conexion falla, sigue con las demas', async () => {
    prisma.googleCalendarConnection.findMany.mockResolvedValue([
      { userId: 'u1' },
      { userId: 'u2' },
    ]);
    jest
      .spyOn(service, 'sync')
      .mockRejectedValueOnce(new Error('token expirado'))
      .mockResolvedValueOnce({ synced: 1 } as any);

    const result = await service.syncAllConnections();

    expect(result).toEqual({ total: 2, ok: 1, failed: 1 });
  });

  it('sin conexiones no llama a sync', async () => {
    prisma.googleCalendarConnection.findMany.mockResolvedValue([]);
    const syncSpy = jest.spyOn(service, 'sync');

    const result = await service.syncAllConnections();

    expect(syncSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ total: 0, ok: 0, failed: 0 });
  });
});
