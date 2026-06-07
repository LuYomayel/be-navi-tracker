import { Test } from '@nestjs/testing';
import { DeviceTokensService } from './device-tokens.service';
import { PrismaService } from '../../config/prisma.service';

describe('DeviceTokensService', () => {
  let service: DeviceTokensService;
  let prisma: {
    deviceToken: {
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      deviceToken: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        DeviceTokensService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(DeviceTokensService);
  });

  describe('register', () => {
    it('hace upsert por token (crea o reasigna al usuario actual)', async () => {
      prisma.deviceToken.upsert.mockResolvedValue({ id: 'd1' });

      await service.register('user-1', 'tok-abc', 'ios');

      expect(prisma.deviceToken.upsert).toHaveBeenCalledWith({
        where: { token: 'tok-abc' },
        create: { userId: 'user-1', token: 'tok-abc', platform: 'ios' },
        update: { userId: 'user-1', platform: 'ios' },
      });
    });
  });

  describe('remove', () => {
    it('borra solo si el token pertenece al usuario (ownership)', async () => {
      prisma.deviceToken.deleteMany.mockResolvedValue({ count: 1 });

      const res = await service.remove('user-1', 'tok-abc');

      expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', token: 'tok-abc' },
      });
      expect(res).toEqual({ success: true });
    });
  });

  describe('getTokensForUser', () => {
    it('devuelve solo los strings de token del usuario', async () => {
      prisma.deviceToken.findMany.mockResolvedValue([
        { token: 'a' },
        { token: 'b' },
      ]);

      const tokens = await service.getTokensForUser('user-1');

      expect(prisma.deviceToken.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        select: { token: true },
      });
      expect(tokens).toEqual(['a', 'b']);
    });
  });

  describe('pruneTokens', () => {
    it('no llama a Prisma si no hay tokens', async () => {
      await service.pruneTokens([]);
      expect(prisma.deviceToken.deleteMany).not.toHaveBeenCalled();
    });

    it('borra los tokens invalidos', async () => {
      prisma.deviceToken.deleteMany.mockResolvedValue({ count: 2 });
      await service.pruneTokens(['x', 'y']);
      expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: { in: ['x', 'y'] } },
      });
    });
  });
});
