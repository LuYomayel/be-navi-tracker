import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { AICostService } from '../ai-cost/ai-cost.service';
import {
  CreateShoppingListDto,
  UpdateShoppingListDto,
  GenerateShoppingListDto,
  CreateShoppingItemDto,
  UpdateShoppingItemDto,
  BulkCheckDto,
} from './dto/shopping-list.dto';

// OpenAI is an optional dependency
let OpenAI: any;
try {
  OpenAI = require('openai').default;
} catch {
  // openai not installed
}

@Injectable()
export class ShoppingListService {
  private readonly logger = new Logger(ShoppingListService.name);

  private openai: any;

  constructor(
    private prisma: PrismaService,
    private aiCostService: AICostService,
  ) {
    if (OpenAI && process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  // === LISTS ===

  async getAllLists(userId: string) {
    return this.prisma.shoppingList.findMany({
      where: { userId },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getListById(id: string, userId: string) {
    const list = await this.prisma.shoppingList.findFirst({
      where: { id, userId },
      include: {
        items: { orderBy: [{ category: 'asc' }, { order: 'asc' }] },
      },
    });
    if (!list) throw new NotFoundException('Lista no encontrada');
    return list;
  }

  async createList(userId: string, dto: CreateShoppingListDto) {
    return this.prisma.shoppingList.create({
      data: {
        userId,
        name: dto.name,
        notes: dto.notes,
        source: 'manual',
      },
      include: { items: true },
    });
  }

  async updateList(id: string, userId: string, dto: UpdateShoppingListDto) {
    const list = await this.prisma.shoppingList.findFirst({
      where: { id, userId },
    });
    if (!list) throw new NotFoundException('Lista no encontrada');

    return this.prisma.shoppingList.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async deleteList(id: string, userId: string) {
    const list = await this.prisma.shoppingList.findFirst({
      where: { id, userId },
    });
    if (!list) throw new NotFoundException('Lista no encontrada');

    await this.prisma.shoppingList.delete({ where: { id } });
    return { deleted: true };
  }

  async generateFromMealPrep(userId: string, dto: GenerateShoppingListDto) {
    // Find meal prep
    const whereClause: any = { userId };
    if (dto.mealPrepId) {
      whereClause.id = dto.mealPrepId;
    } else {
      whereClause.status = 'active';
    }

    const mealPrep = await this.prisma.mealPrep.findFirst({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
    });

    if (!mealPrep) {
      throw new NotFoundException(
        'No se encontro un meal prep activo. Genera uno primero.',
      );
    }

    // Extract all foods from meal prep, deduplicating with quantities
    const days = mealPrep.days as any;
    const foodMap = new Map<string, { count: number; quantities: string[] }>();

    for (const dayKey of Object.keys(days)) {
      const day = days[dayKey];
      if (!day) continue;
      const slots = day.slots || day;
      for (const slotKey of ['breakfast', 'lunch', 'snack', 'dinner']) {
        const slot = slots[slotKey];
        if (slot?.foods && Array.isArray(slot.foods)) {
          for (const food of slot.foods) {
            const name = (
              typeof food === 'string' ? food : food.name || food
            )
              .toString()
              .trim();
            const key = name.toLowerCase();
            const qty =
              typeof food === 'object' && food.quantity
                ? food.quantity.toString()
                : '';

            if (!foodMap.has(key)) {
              foodMap.set(key, { count: 0, quantities: [] });
            }
            const entry = foodMap.get(key)!;
            entry.count += 1;
            if (qty) entry.quantities.push(qty);
          }
        }
      }
    }

    if (foodMap.size === 0) {
      throw new NotFoundException(
        'El meal prep no tiene alimentos para generar una lista.',
      );
    }

    // Build deduplicated food list with counts for the AI
    const deduplicatedFoods: string[] = [];
    for (const [key, entry] of foodMap) {
      const displayName = key.charAt(0).toUpperCase() + key.slice(1);
      const parts: string[] = [`${displayName} x${entry.count}`];
      if (entry.quantities.length > 0) {
        const uniqueQtys = [...new Set(entry.quantities)];
        parts.push(`(${uniqueQtys.join(', ')})`);
      }
      deduplicatedFoods.push(parts.join(' '));
    }

    // Generate with AI
    const { items, completion } =
      await this.generateItemsWithAI(deduplicatedFoods);

    // Log AI cost
    if (completion?.usage) {
      await this.aiCostService.logFromCompletion(
        userId,
        'shopping-list-generate',
        completion,
      );
    }

    // Create list with items in a transaction
    const listName =
      dto.name || `Lista de compras - ${mealPrep.name || mealPrep.weekStartDate}`;

    const list = await this.prisma.shoppingList.create({
      data: {
        userId,
        name: listName,
        source: 'meal_prep',
        mealPrepId: mealPrep.id,
        aiCostUsd: completion?.usage
          ? this.estimateCost(completion.usage)
          : null,
        items: {
          create: items.map((item: any, index: number) => ({
            name: item.name,
            quantity: item.quantity || null,
            category: item.category || 'other',
            order: index,
          })),
        },
      },
      include: {
        items: { orderBy: [{ category: 'asc' }, { order: 'asc' }] },
      },
    });

    return list;
  }

  // === ITEMS ===

  async addItem(
    listId: string,
    userId: string,
    dto: CreateShoppingItemDto,
  ) {
    const list = await this.prisma.shoppingList.findFirst({
      where: { id: listId, userId },
    });
    if (!list) throw new NotFoundException('Lista no encontrada');

    return this.prisma.shoppingItem.create({
      data: {
        shoppingListId: listId,
        name: dto.name,
        quantity: dto.quantity,
        category: dto.category,
        notes: dto.notes,
        order: dto.order ?? 0,
      },
    });
  }

  async updateItem(
    listId: string,
    itemId: string,
    userId: string,
    dto: UpdateShoppingItemDto,
  ) {
    const list = await this.prisma.shoppingList.findFirst({
      where: { id: listId, userId },
    });
    if (!list) throw new NotFoundException('Lista no encontrada');

    return this.prisma.shoppingItem.update({
      where: { id: itemId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.checked !== undefined && {
          checked: dto.checked,
          checkedAt: dto.checked ? new Date() : null,
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.order !== undefined && { order: dto.order }),
      },
    });
  }

  async deleteItem(listId: string, itemId: string, userId: string) {
    const list = await this.prisma.shoppingList.findFirst({
      where: { id: listId, userId },
    });
    if (!list) throw new NotFoundException('Lista no encontrada');

    await this.prisma.shoppingItem.delete({ where: { id: itemId } });
    return { deleted: true };
  }

  async bulkCheck(listId: string, userId: string, dto: BulkCheckDto) {
    const list = await this.prisma.shoppingList.findFirst({
      where: { id: listId, userId },
    });
    if (!list) throw new NotFoundException('Lista no encontrada');

    await this.prisma.shoppingItem.updateMany({
      where: {
        id: { in: dto.itemIds },
        shoppingListId: listId,
      },
      data: {
        checked: dto.checked,
        checkedAt: dto.checked ? new Date() : null,
      },
    });

    return this.prisma.shoppingItem.findMany({
      where: { shoppingListId: listId },
      orderBy: [{ category: 'asc' }, { order: 'asc' }],
    });
  }

  async uncheckAll(listId: string, userId: string) {
    const list = await this.prisma.shoppingList.findFirst({
      where: { id: listId, userId },
    });
    if (!list) throw new NotFoundException('Lista no encontrada');

    await this.prisma.shoppingItem.updateMany({
      where: { shoppingListId: listId },
      data: { checked: false, checkedAt: null },
    });
    return { success: true };
  }

  // === PRIVATE AI HELPERS ===

  private async generateItemsWithAI(foods: string[]) {
    if (!this.openai) {
      // Fallback: create basic list from foods without AI
      return { items: this.fallbackGenerate(foods), completion: null };
    }

    const prompt = `Estos son los alimentos de un meal prep semanal (7 dias x 4 comidas), ya agrupados con la cantidad de veces que aparecen y sus porciones:
${foods.join('\n')}

Genera una lista de compras para la semana. Reglas:
1. Los alimentos ya estan deduplicados. El "xN" indica cuantas veces aparece en la semana. Usa esa info para estimar la cantidad total a comprar.
2. Si un alimento tiene porciones entre parentesis (ej: "200g, 150g"), suma esas cantidades.
3. Cada item debe tener: name, quantity (cantidad total estimada para la semana), category.
4. Categorias validas: "produce" (verduras/frutas), "protein" (carnes/huevos/legumbres), "dairy" (lacteos), "grains" (harinas/cereales/pastas), "pantry" (aceites/condimentos/enlatados), "frozen" (congelados), "other".
5. Omite agua y condimentos genericos como "sal" y "pimienta".

Responde UNICAMENTE con JSON valido:
{
  "items": [
    { "name": "Pechuga de pollo", "quantity": "1.5 kg", "category": "protein" },
    ...
  ]
}`;

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.1,
        max_tokens: 2000,
        messages: [
          {
            role: 'system',
            content:
              'Eres un asistente de compras. Genera listas de compras organizadas por categoria a partir de planes de comidas. Responde solo con JSON valido.',
          },
          { role: 'user', content: prompt },
        ],
      });

      const content = completion.choices[0]?.message?.content || '';
      const cleaned = content.replace(/```json\n?|```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);

      return { items: parsed.items || [], completion };
    } catch (error) {
      this.logger.error('Error generating shopping list with AI:', error);
      return { items: this.fallbackGenerate(foods), completion: null };
    }
  }

  private fallbackGenerate(foods: string[]) {
    // Foods are already deduplicated with "Name xN (qty)" format
    return foods.map((entry, i) => {
      // Extract name from "Name xN (qty)" format
      const match = entry.match(/^(.+?)\s+x\d+/);
      const name = match ? match[1].trim() : entry;
      return {
        name,
        quantity: null,
        category: 'other',
        order: i,
      };
    });
  }

  private estimateCost(usage: any): number {
    // gpt-4o-mini pricing: $0.15/1M input, $0.60/1M output
    const inputCost = (usage.prompt_tokens / 1_000_000) * 0.15;
    const outputCost = (usage.completion_tokens / 1_000_000) * 0.6;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
  }
}
