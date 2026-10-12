import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ResellersService } from './resellers.service';
import { PrismaService } from '../../config/prisma.service';

describe('ResellersService', () => {
  let service: ResellersService;
  let prisma: any;

  const userId = 'user-1';
  const legacyToken = 'token-legacy';

  const settings = { id: 's1', userId, publicToken: legacyToken };
  const marcelito = {
    id: 'res-1',
    userId,
    name: 'Marcelito',
    token: legacyToken,
    active: true,
  };
  const miguelito = {
    id: 'res-2',
    userId,
    name: 'Miguelito',
    token: 'token-miguel',
    active: true,
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResellersService,
        {
          provide: PrismaService,
          useValue: {
            printSettings: {
              findUnique: jest.fn().mockImplementation(({ where }) =>
                Promise.resolve(
                  where.userId === userId || where.publicToken === legacyToken
                    ? settings
                    : null,
                ),
              ),
            },
            printReseller: {
              findUnique: jest.fn().mockResolvedValue(null),
              findFirst: jest.fn().mockResolvedValue(null),
              findMany: jest.fn().mockResolvedValue([]),
              count: jest.fn().mockResolvedValue(0),
              create: jest.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'res-new', active: true, ...data }),
              ),
              update: jest.fn().mockImplementation(({ where, data }) =>
                Promise.resolve({ ...marcelito, id: where.id, ...data }),
              ),
            },
            printOrder: {
              updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
          },
        },
      ],
    }).compile();

    service = module.get(ResellersService);
    prisma = module.get(PrismaService);
  });

  describe('resolveToken', () => {
    it('token de un revendedor activo devuelve el revendedor y los settings del dueno', async () => {
      prisma.printReseller.findUnique.mockResolvedValue(miguelito);
      const res = await service.resolveToken('token-miguel');
      expect(res.reseller.id).toBe('res-2');
      expect(res.settings.userId).toBe(userId);
    });

    it('token de un revendedor desactivado tira NotFound', async () => {
      prisma.printReseller.findUnique.mockResolvedValue({
        ...miguelito,
        active: false,
      });
      await expect(service.resolveToken('token-miguel')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('token desconocido tira NotFound', async () => {
      await expect(service.resolveToken('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('el link viejo (publicToken) crea a Marcelito con ese mismo token y le asigna sus pedidos', async () => {
      const res = await service.resolveToken(legacyToken);

      expect(prisma.printReseller.create).toHaveBeenCalledWith({
        data: { userId, name: 'Marcelito', token: legacyToken },
      });
      expect(prisma.printOrder.updateMany).toHaveBeenCalledWith({
        where: { userId, resellerId: null, customerName: 'Marcelito' },
        data: { resellerId: 'res-new' },
      });
      expect(res.reseller.name).toBe('Marcelito');
    });

    it('el link viejo deja de servir si el dueno ya tiene revendedores (rotar el token revoca de verdad)', async () => {
      prisma.printReseller.count.mockResolvedValue(1);
      await expect(service.resolveToken(legacyToken)).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.printReseller.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('sin revendedores migra el link viejo a Marcelito antes de listar', async () => {
      prisma.printReseller.findMany.mockResolvedValue([marcelito]);
      const res = await service.list(userId);
      expect(prisma.printReseller.create).toHaveBeenCalledWith({
        data: { userId, name: 'Marcelito', token: legacyToken },
      });
      expect(res).toHaveLength(1);
    });

    it('con revendedores no vuelve a migrar', async () => {
      prisma.printReseller.count.mockResolvedValue(2);
      prisma.printReseller.findMany.mockResolvedValue([marcelito, miguelito]);
      await service.list(userId);
      expect(prisma.printReseller.create).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('crea el revendedor con un token propio', async () => {
      prisma.printReseller.count.mockResolvedValue(1);
      const res = await service.create(userId, { name: '  Miguelito ' });
      expect(prisma.printReseller.create).toHaveBeenCalledWith({
        data: { userId, name: 'Miguelito', token: expect.any(String) },
      });
      expect(res.token).not.toBe(legacyToken);
    });

    it('sin nombre tira BadRequest', async () => {
      await expect(service.create(userId, { name: '  ' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('nombre repetido tira BadRequest', async () => {
      prisma.printReseller.findFirst.mockResolvedValue(marcelito);
      await expect(
        service.create(userId, { name: 'Marcelito' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('update / regenerateToken', () => {
    it('no toca un revendedor de otro usuario', async () => {
      await expect(
        service.update('otro-user', 'res-1', { active: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it('desactiva un revendedor', async () => {
      prisma.printReseller.findFirst.mockResolvedValue(marcelito);
      await service.update(userId, 'res-1', { active: false });
      expect(prisma.printReseller.update).toHaveBeenCalledWith({
        where: { id: 'res-1' },
        data: { active: false },
      });
    });

    it('regenerar le cambia el token', async () => {
      prisma.printReseller.findFirst.mockResolvedValue(marcelito);
      const res = await service.regenerateToken(userId, 'res-1');
      expect(res.token).not.toBe(legacyToken);
    });
  });
});
