import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ShoppingListService } from './shopping-list.service';
import { PrismaService } from '../../config/prisma.service';
import { AICostService } from '../ai-cost/ai-cost.service';

describe('ShoppingListService', () => {
  let service: ShoppingListService;
  let prisma: PrismaService;

  const userId = 'user-1';

  const mockList = {
    id: 'list-1',
    userId,
    name: 'Lista semanal',
    notes: null,
    source: 'manual',
    status: 'active',
    mealPrepId: null,
    aiCostUsd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockItem = {
    id: 'item-1',
    shoppingListId: 'list-1',
    name: 'Pollo',
    quantity: '1 kg',
    category: 'protein',
    checked: false,
    checkedAt: null,
    notes: null,
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ShoppingListService,
        {
          provide: PrismaService,
          useValue: {
            shoppingList: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            shoppingItem: {
              create: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              updateMany: jest.fn(),
              findMany: jest.fn(),
            },
            mealPrep: {
              findFirst: jest.fn(),
            },
          },
        },
        {
          provide: AICostService,
          useValue: {
            logFromCompletion: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ShoppingListService>(ShoppingListService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  // ═══════════════════════════════════════════════════════════
  // LISTS CRUD
  // ═══════════════════════════════════════════════════════════

  describe('getAllLists', () => {
    it('should return all lists for user with item count', async () => {
      const lists = [{ ...mockList, _count: { items: 5 } }];
      (prisma.shoppingList.findMany as jest.Mock).mockResolvedValue(lists);

      const result = await service.getAllLists(userId);

      expect(result).toEqual(lists);
      expect(prisma.shoppingList.findMany).toHaveBeenCalledWith({
        where: { userId },
        include: { _count: { select: { items: true } } },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should return empty array when no lists', async () => {
      (prisma.shoppingList.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getAllLists(userId);

      expect(result).toEqual([]);
    });
  });

  describe('getListById', () => {
    it('should return list with items', async () => {
      const listWithItems = { ...mockList, items: [mockItem] };
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(listWithItems);

      const result = await service.getListById('list-1', userId);

      expect(result).toEqual(listWithItems);
      expect(prisma.shoppingList.findFirst).toHaveBeenCalledWith({
        where: { id: 'list-1', userId },
        include: { items: { orderBy: [{ category: 'asc' }, { order: 'asc' }] } },
      });
    });

    it('should throw NotFoundException when list not found', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getListById('nonexistent', userId)).rejects.toThrow(NotFoundException);
    });

    it('should not return another user list', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.getListById('list-1', 'other-user')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createList', () => {
    it('should create a manual list', async () => {
      const created = { ...mockList, items: [] };
      (prisma.shoppingList.create as jest.Mock).mockResolvedValue(created);

      const result = await service.createList(userId, { name: 'Lista semanal' });

      expect(result).toEqual(created);
      expect(prisma.shoppingList.create).toHaveBeenCalledWith({
        data: { userId, name: 'Lista semanal', notes: undefined, source: 'manual' },
        include: { items: true },
      });
    });
  });

  describe('updateList', () => {
    it('should update list name', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(mockList);
      (prisma.shoppingList.update as jest.Mock).mockResolvedValue({ ...mockList, name: 'Nuevo nombre' });

      const result = await service.updateList('list-1', userId, { name: 'Nuevo nombre' });

      expect(result.name).toBe('Nuevo nombre');
    });

    it('should update list status to archived', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(mockList);
      (prisma.shoppingList.update as jest.Mock).mockResolvedValue({ ...mockList, status: 'archived' });

      const result = await service.updateList('list-1', userId, { status: 'archived' });

      expect(result.status).toBe('archived');
    });

    it('should throw NotFoundException for non-existent list', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.updateList('nonexistent', userId, { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteList', () => {
    it('should delete the list', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(mockList);
      (prisma.shoppingList.delete as jest.Mock).mockResolvedValue(mockList);

      const result = await service.deleteList('list-1', userId);

      expect(result).toEqual({ deleted: true });
      expect(prisma.shoppingList.delete).toHaveBeenCalledWith({ where: { id: 'list-1' } });
    });

    it('should throw NotFoundException when list not found', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteList('nonexistent', userId)).rejects.toThrow(NotFoundException);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // GENERATE FROM MEAL PREP
  // ═══════════════════════════════════════════════════════════

  describe('generateFromMealPrep', () => {
    it('should throw NotFoundException when no active meal prep', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.generateFromMealPrep(userId, {})).rejects.toThrow(NotFoundException);
    });

    it('should throw NotFoundException when meal prep has no foods', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue({
        id: 'prep-1',
        days: {
          monday: { slots: { breakfast: { foods: [] }, lunch: null, snack: null, dinner: null } },
        },
      });

      await expect(service.generateFromMealPrep(userId, {})).rejects.toThrow(
        'El meal prep no tiene alimentos para generar una lista.',
      );
    });

    it('should extract foods from meal prep using day.slots structure', async () => {
      const mealPrep = {
        id: 'prep-1',
        name: 'Semana 1',
        weekStartDate: '2026-03-16',
        days: {
          monday: {
            slots: {
              breakfast: { foods: ['Avena', 'Banana'], name: 'Desayuno' },
              lunch: { foods: [{ name: 'Pollo', quantity: '200g' }], name: 'Almuerzo' },
              snack: null,
              dinner: { foods: ['Ensalada'], name: 'Cena' },
            },
          },
          tuesday: {
            slots: {
              breakfast: { foods: ['Avena', 'Banana'], name: 'Desayuno' }, // duplicate
              lunch: null,
              snack: null,
              dinner: null,
            },
          },
        },
      };
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(mealPrep);
      // Service will call generateItemsWithAI which uses this.openai
      // Since openai is null in test env, it falls back to fallbackGenerate
      (prisma.shoppingList.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'list-new',
          ...data,
          items: (data.items?.create || []).map((item: any, i: number) => ({
            id: `item-${i}`,
            ...item,
          })),
        }),
      );

      const result = await service.generateFromMealPrep(userId, {});

      expect(result.source).toBe('meal_prep');
      expect(result.mealPrepId).toBe('prep-1');
      // Should have deduplicated: Avena x2, Banana x2, Pollo x1, Ensalada x1 = 4 items
      expect(result.items).toHaveLength(4);
    });

    it('should use specific mealPrepId when provided', async () => {
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.generateFromMealPrep(userId, { mealPrepId: 'specific-id' }),
      ).rejects.toThrow(NotFoundException);

      expect(prisma.mealPrep.findFirst).toHaveBeenCalledWith({
        where: { userId, id: 'specific-id' },
        orderBy: { createdAt: 'desc' },
      });
    });

    it('should handle legacy data without slots nesting', async () => {
      // Legacy format: foods directly on day (no .slots)
      const mealPrep = {
        id: 'prep-1',
        name: 'Legacy',
        weekStartDate: '2026-03-16',
        days: {
          monday: {
            breakfast: { foods: ['Huevos'] },
            lunch: null,
            snack: null,
            dinner: null,
          },
        },
      };
      (prisma.mealPrep.findFirst as jest.Mock).mockResolvedValue(mealPrep);
      (prisma.shoppingList.create as jest.Mock).mockImplementation(({ data }) =>
        Promise.resolve({
          id: 'list-new',
          ...data,
          items: (data.items?.create || []).map((item: any, i: number) => ({
            id: `item-${i}`,
            ...item,
          })),
        }),
      );

      const result = await service.generateFromMealPrep(userId, {});

      expect(result.items).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // ITEMS CRUD
  // ═══════════════════════════════════════════════════════════

  describe('addItem', () => {
    it('should add item to list', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(mockList);
      (prisma.shoppingItem.create as jest.Mock).mockResolvedValue(mockItem);

      const result = await service.addItem('list-1', userId, {
        name: 'Pollo',
        quantity: '1 kg',
        category: 'protein',
      });

      expect(result).toEqual(mockItem);
    });

    it('should throw NotFoundException when list not found', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.addItem('nonexistent', userId, { name: 'x', category: 'other' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateItem', () => {
    it('should update item fields', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(mockList);
      (prisma.shoppingItem.update as jest.Mock).mockResolvedValue({
        ...mockItem,
        name: 'Pechuga de pollo',
      });

      const result = await service.updateItem('list-1', 'item-1', userId, {
        name: 'Pechuga de pollo',
      });

      expect(result.name).toBe('Pechuga de pollo');
    });

    it('should set checkedAt when checking item', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(mockList);
      (prisma.shoppingItem.update as jest.Mock).mockResolvedValue({
        ...mockItem,
        checked: true,
        checkedAt: new Date(),
      });

      await service.updateItem('list-1', 'item-1', userId, { checked: true });

      expect(prisma.shoppingItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: expect.objectContaining({
          checked: true,
          checkedAt: expect.any(Date),
        }),
      });
    });

    it('should clear checkedAt when unchecking item', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(mockList);
      (prisma.shoppingItem.update as jest.Mock).mockResolvedValue({
        ...mockItem,
        checked: false,
        checkedAt: null,
      });

      await service.updateItem('list-1', 'item-1', userId, { checked: false });

      expect(prisma.shoppingItem.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: expect.objectContaining({
          checked: false,
          checkedAt: null,
        }),
      });
    });
  });

  describe('deleteItem', () => {
    it('should delete item from list', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(mockList);
      (prisma.shoppingItem.delete as jest.Mock).mockResolvedValue(mockItem);

      const result = await service.deleteItem('list-1', 'item-1', userId);

      expect(result).toEqual({ deleted: true });
    });

    it('should throw NotFoundException when list not found', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.deleteItem('nonexistent', 'item-1', userId)).rejects.toThrow(NotFoundException);
    });
  });

  describe('bulkCheck', () => {
    it('should bulk check multiple items', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(mockList);
      (prisma.shoppingItem.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
      (prisma.shoppingItem.findMany as jest.Mock).mockResolvedValue([
        { ...mockItem, checked: true },
        { ...mockItem, id: 'item-2', checked: true },
      ]);

      const result = await service.bulkCheck('list-1', userId, {
        itemIds: ['item-1', 'item-2'],
        checked: true,
      });

      expect(result).toHaveLength(2);
      expect(prisma.shoppingItem.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['item-1', 'item-2'] }, shoppingListId: 'list-1' },
        data: { checked: true, checkedAt: expect.any(Date) },
      });
    });

    it('should throw NotFoundException when list not found', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.bulkCheck('nonexistent', userId, { itemIds: ['item-1'], checked: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('uncheckAll', () => {
    it('should uncheck all items in list', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(mockList);
      (prisma.shoppingItem.updateMany as jest.Mock).mockResolvedValue({ count: 3 });

      const result = await service.uncheckAll('list-1', userId);

      expect(result).toEqual({ success: true });
      expect(prisma.shoppingItem.updateMany).toHaveBeenCalledWith({
        where: { shoppingListId: 'list-1' },
        data: { checked: false, checkedAt: null },
      });
    });

    it('should throw NotFoundException when list not found', async () => {
      (prisma.shoppingList.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.uncheckAll('nonexistent', userId)).rejects.toThrow(NotFoundException);
    });
  });
});
