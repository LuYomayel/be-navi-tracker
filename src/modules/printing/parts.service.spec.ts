import { BadRequestException } from '@nestjs/common';
import { PartsService } from './parts.service';

describe('PartsService', () => {
  const userId = 'user-1';
  let prisma: any;
  let service: PartsService;

  // Rollos: el sync desconto de estos (color canonico en minuscula)
  const filaments = [
    { id: 'f-rojo', color: 'Rojo' },
    { id: 'f-blanco', color: 'blanco' },
    { id: 'f-amarillo', color: 'amarillo' },
    { id: 'f-rosa', color: 'rosa' },
  ];
  const parts = [
    { id: 'p-punta', userId, productId: 'carrot', key: 'punta', name: 'Punta' },
    {
      id: 'p-cara',
      userId,
      productId: 'carrot',
      key: 'cara-dado',
      name: 'Cara del dado',
    },
  ];
  const job4 = {
    id: 'job-1',
    userId,
    title: '0.2mm layer',
    stockApplied: true,
    appliedPlan: [
      { filamentId: 'f-rojo', grams: 6.1 },
      { filamentId: 'f-blanco', grams: 6.4 },
      { filamentId: 'f-amarillo', grams: 6.6 },
      { filamentId: 'f-rosa', grams: 6.1 },
    ],
    filamentsUsed: [],
  };

  beforeEach(() => {
    prisma = {
      printJob: {
        findFirst: jest.fn().mockResolvedValue(job4),
        update: jest.fn().mockResolvedValue({}),
      },
      filament: { findMany: jest.fn().mockResolvedValue(filaments) },
      printPart: {
        findMany: jest.fn().mockResolvedValue(parts),
      },
      printPartMove: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      printPlateTemplate: {
        upsert: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      printRecipeLine: { findMany: jest.fn().mockResolvedValue([]) },
      printOrder: { findFirst: jest.fn() },
      printProduct: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = new PartsService(prisma);
  });

  describe('setJobOutputs (lo que salio de una impresion)', () => {
    it('perColorLine: 4 puntas + 1 cara por CADA color que desconto la impresion', async () => {
      await service.setJobOutputs(userId, 'job-1', [
        { partId: 'p-punta', qty: 4, perColorLine: true },
        { partId: 'p-cara', qty: 1, perColorLine: true },
      ]);
      // reemplaza lo que esa impresion habia sumado antes
      expect(prisma.printPartMove.deleteMany).toHaveBeenCalledWith({
        where: { userId, jobId: 'job-1', reason: 'impresion' },
      });
      const data = prisma.printPartMove.createMany.mock.calls[0][0].data;
      expect(data).toHaveLength(8);
      expect(data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            partId: 'p-punta',
            color: 'rojo',
            qty: 4,
            reason: 'impresion',
            jobId: 'job-1',
          }),
          expect.objectContaining({ partId: 'p-cara', color: 'rosa', qty: 1 }),
        ]),
      );
      // guarda los outputs en la impresion para recalcular si se corrige el color
      expect(prisma.printJob.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ partsOutputs: expect.any(Array) }),
        }),
      );
    });

    it('sin color en una impresion multicolor pide el color (o perColorLine)', async () => {
      await expect(
        service.setJobOutputs(userId, 'job-1', [{ partId: 'p-punta', qty: 6 }]),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.printPartMove.createMany).not.toHaveBeenCalled();
    });

    it('impresion de un solo color: sin color usa ese', async () => {
      prisma.printJob.findFirst.mockResolvedValue({
        ...job4,
        appliedPlan: [{ filamentId: 'f-rojo', grams: 60 }],
      });
      await service.setJobOutputs(userId, 'job-1', [
        { partId: 'p-punta', qty: 6 },
      ]);
      expect(prisma.printPartMove.createMany.mock.calls[0][0].data).toEqual([
        expect.objectContaining({ partId: 'p-punta', color: 'rojo', qty: 6 }),
      ]);
    });

    it('una pieza que no es del usuario se rechaza', async () => {
      await expect(
        service.setJobOutputs(userId, 'job-1', [
          { partId: 'ajena', qty: 1, color: 'rojo' },
        ]),
      ).rejects.toThrow(BadRequestException);
    });

    it('remember guarda la plantilla de la placa con su plateKey', async () => {
      prisma.printJob.findFirst.mockResolvedValue({
        ...job4,
        plateKey: 'placa-8',
      });
      await service.setJobOutputs(
        userId,
        'job-1',
        [{ partId: 'p-punta', qty: 4, perColorLine: true }],
        { remember: true },
      );
      expect(prisma.printPlateTemplate.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_matchKey: { userId, matchKey: 'placa-8' } },
        }),
      );
    });
  });

  describe('applyTemplate (placa conocida en el sync)', () => {
    const tpl = {
      matchKey: '2868821:8',
      weight: 25.2,
      outputs: [{ partId: 'p-punta', qty: 4, perColorLine: true }],
    };
    beforeEach(() => {
      prisma.printJob.findFirst.mockResolvedValue({
        ...job4,
        plateKey: '2868821:8',
        grams: 25.18,
        status: 'ok',
      });
      prisma.printPlateTemplate.findUnique.mockResolvedValue(tpl);
    });

    it('suma las piezas de la plantilla', async () => {
      await service.applyTemplate(userId, 'job-1');
      expect(prisma.printPartMove.createMany.mock.calls[0][0].data).toHaveLength(4);
    });

    it('con repeticiones multiplica', async () => {
      await service.applyTemplate(userId, 'job-1', { multiplier: 2 });
      expect(prisma.printPartMove.createMany.mock.calls[0][0].data[0].qty).toBe(8);
    });

    it('otro 3MF con el mismo numero de placa (peso distinto) no aplica', async () => {
      prisma.printJob.findFirst.mockResolvedValue({
        ...job4,
        plateKey: '2868821:8',
        grams: 60,
        status: 'ok',
      });
      expect(await service.applyTemplate(userId, 'job-1')).toBeNull();
      expect(prisma.printPartMove.createMany).not.toHaveBeenCalled();
    });

    it('una placa incompleta (objetos salteados) no aplica', async () => {
      expect(await service.applyTemplate(userId, 'job-1', { partial: true })).toBeNull();
      expect(prisma.printPartMove.createMany).not.toHaveBeenCalled();
    });
  });

  describe('consumeForOrder (al entregar)', () => {
    it('resta las piezas de las unidades entregadas y avisa lo que falta', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        id: 'ord-1',
        userId,
        items: [{ productId: 'carrot', qty: 2, product: { name: 'Carrot' } }],
      });
      prisma.printRecipeLine.findMany.mockResolvedValue([
        {
          productId: 'carrot',
          partId: 'p-punta',
          qty: 1,
          colorMode: 'distintos',
          group: 'colores',
          slot: 's1',
        },
        {
          productId: 'carrot',
          partId: 'p-punta',
          qty: 1,
          colorMode: 'distintos',
          group: 'colores',
          slot: 's2',
        },
      ]);
      prisma.printPartMove.findMany.mockResolvedValue([
        { partId: 'p-punta', color: 'rojo', qty: 1 },
        { partId: 'p-punta', color: 'azul', qty: 1 },
      ]);

      const res = await service.consumeForOrder(userId, 'ord-1');

      // la entrega anterior de este pedido (si la hubo) se reemplaza
      expect(prisma.printPartMove.deleteMany).toHaveBeenCalledWith({
        where: { userId, orderId: 'ord-1', reason: 'entrega' },
      });
      const data = prisma.printPartMove.createMany.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            partId: 'p-punta',
            color: 'rojo',
            qty: -1,
            reason: 'entrega',
            orderId: 'ord-1',
          }),
          expect.objectContaining({
            partId: 'p-punta',
            color: 'azul',
            qty: -1,
          }),
        ]),
      );
      expect(res.shortfall.join(' ')).toMatch(/Carrot: faltan 1 de 2/);
    });

    it('un producto sin receta no consume ni avisa', async () => {
      prisma.printOrder.findFirst.mockResolvedValue({
        id: 'ord-1',
        userId,
        items: [{ productId: 'otro', qty: 1, product: { name: 'Otro' } }],
      });
      const res = await service.consumeForOrder(userId, 'ord-1');
      expect(prisma.printPartMove.createMany).not.toHaveBeenCalled();
      expect(res.shortfall).toEqual([]);
    });
  });

  describe('revertOrder (sacar la entrega)', () => {
    it('borra los movimientos de entrega del pedido (las piezas vuelven al stock)', async () => {
      await service.revertOrder(userId, 'ord-1');
      expect(prisma.printPartMove.deleteMany).toHaveBeenCalledWith({
        where: { userId, orderId: 'ord-1', reason: 'entrega' },
      });
    });
  });
});
