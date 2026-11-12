import { TrelloService } from './trello.service';

describe('TrelloService.getMyTickets', () => {
  let service: TrelloService;
  let api: jest.Mock;

  beforeEach(() => {
    process.env.TRELLO_API_KEY = 'k';
    process.env.TRELLO_TOKEN = 't';
    service = new TrelloService();
    api = jest.fn(async (path: string) => {
      if (path.startsWith('/members/me')) return { id: 'me' };
      if (path.includes('/lists')) return [{ id: 'l1', name: '📅 Working On' }];
      if (path.includes('/cards'))
        return [
          {
            name: 'Mía',
            idList: 'l1',
            idMembers: ['me'],
            shortUrl: 'u1',
            dateLastActivity: '2026-11-10T12:00:00.000Z',
          },
          {
            name: 'De otro',
            idList: 'l1',
            idMembers: ['otro'],
            shortUrl: 'u2',
            dateLastActivity: '2026-11-01T12:00:00.000Z',
          },
        ];
      return [];
    });
    (service as any).api = api;
  });

  it('pide dateLastActivity y devuelve en cada card la última actividad y si es mía', async () => {
    const res = await service.getMyTickets();
    const cardsCall = api.mock.calls.find((c) => c[0].includes('/cards'))![0];
    expect(cardsCall).toContain('dateLastActivity');

    const stampia = res.boards.find((b) => b.code === 'STA')!;
    expect(stampia.buckets.en_curso).toEqual([
      expect.objectContaining({ name: 'Mía', mine: true, lastActivity: '2026-11-10T12:00:00.000Z' }),
      expect.objectContaining({ name: 'De otro', mine: false }),
    ]);
  });

  it('en boards mineOnly (Platform Dev) sólo vienen las mías', async () => {
    const res = await service.getMyTickets();
    const pla = res.boards.find((b) => b.code === 'PLA')!;
    expect(pla.buckets.en_curso.map((c) => c.name)).toEqual(['Mía']);
  });

  it('getMyTicketsCached no vuelve a pegarle a Trello dentro de la ventana de cache', async () => {
    await service.getMyTicketsCached();
    const calls = api.mock.calls.length;
    await service.getMyTicketsCached();
    expect(api.mock.calls.length).toBe(calls);
  });
});
