import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import {
  ImportNutritionistPlanDto,
  UpdateNutritionistPlanDto,
  GenerateMealPrepDto,
  CreateMealPrepDto,
  UpdateMealPrepDto,
  UpdateSlotDto,
  MarkSlotEatenDto,
  MealPrepWeek,
  MacroSummary,
  DayKey,
  MealSlotKey,
} from './dto';
import { NutritionService } from '../nutrition/nutrition.service';
import { SavedMealsService } from '../saved-meals/saved-meals.service';
import { AICostService } from '../ai-cost/ai-cost.service';
import OpenAI from 'openai';
import { resolveImageUrl } from '../../common/utils/image.utils';

const DAY_KEYS: DayKey[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const MEAL_SLOT_KEYS: MealSlotKey[] = [
  'breakfast',
  'lunch',
  'snack',
  'dinner',
];

@Injectable()
export class MealPrepService {
  private openai: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
    private nutritionService: NutritionService,
    private savedMealsService: SavedMealsService,
    private aiCostService: AICostService,
  ) {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // NUTRITIONIST PLANS
  // ═══════════════════════════════════════════════════════════

  async getAllNutritionistPlans(userId: string) {
    return this.prisma.nutritionistPlan.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getActiveNutritionistPlan(userId: string) {
    return this.prisma.nutritionistPlan.findFirst({
      where: { userId, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async importNutritionistPlan(
    dto: ImportNutritionistPlanDto,
    userId: string,
  ) {
    if (!dto.images || dto.images.length === 0) {
      throw new BadRequestException(
        'Se requiere al menos una imagen del PDF',
      );
    }

    if (!this.openai) {
      throw new BadRequestException('OpenAI API key no configurada');
    }

    // Parsear PDF con OpenAI Vision
    const { parsedPlan, rawText, confidence, completion } =
      await this.parsePdfWithAI(dto.images);

    // Log AI cost
    try {
      await this.aiCostService.logFromCompletion(
        userId,
        'meal-prep-pdf-import',
        completion,
      );
    } catch (e) {
      console.error('Error logging AI cost:', e);
    }

    // Desactivar planes anteriores
    await this.prisma.nutritionistPlan.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });

    // Crear nuevo plan activo
    const plan = await this.prisma.nutritionistPlan.create({
      data: {
        userId,
        name: dto.name,
        rawText,
        parsedPlan: JSON.parse(JSON.stringify(parsedPlan)),
        weeklyNotes: parsedPlan.generalNotes || null,
        pdfFilename: dto.pdfFilename || null,
        isActive: true,
        aiConfidence: confidence,
      },
    });

    return plan;
  }

  async updateNutritionistPlan(
    id: string,
    dto: UpdateNutritionistPlanDto,
    userId: string,
  ) {
    const plan = await this.prisma.nutritionistPlan.findFirst({
      where: { id, userId },
    });

    if (!plan) {
      throw new NotFoundException('Plan no encontrado');
    }

    // Si se activa este plan, desactivar los demás
    if (dto.isActive === true) {
      await this.prisma.nutritionistPlan.updateMany({
        where: { userId, isActive: true, id: { not: id } },
        data: { isActive: false },
      });
    }

    return this.prisma.nutritionistPlan.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async deleteNutritionistPlan(id: string, userId: string): Promise<boolean> {
    const plan = await this.prisma.nutritionistPlan.findFirst({
      where: { id, userId },
    });

    if (!plan) {
      throw new NotFoundException('Plan no encontrado');
    }

    await this.prisma.nutritionistPlan.delete({ where: { id } });
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // MEAL PREPS
  // ═══════════════════════════════════════════════════════════

  async getAllMealPreps(userId: string) {
    return this.prisma.mealPrep.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getActiveMealPrep(userId: string) {
    const today = new Date().toISOString().split('T')[0];
    return this.prisma.mealPrep.findFirst({
      where: {
        userId,
        status: 'active',
        weekStartDate: { lte: today },
        weekEndDate: { gte: today },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMealPrepById(id: string, userId: string) {
    return this.prisma.mealPrep.findFirst({
      where: { id, userId },
    });
  }

  async createMealPrep(dto: CreateMealPrepDto, userId: string) {
    const weekEndDate = this.calculateWeekEndDate(dto.weekStartDate);
    const totals = this.computeTotals(dto.days);

    // Archivar prep activo de la misma semana
    await this.prisma.mealPrep.updateMany({
      where: {
        userId,
        status: 'active',
        weekStartDate: dto.weekStartDate,
      },
      data: { status: 'archived' },
    });

    return this.prisma.mealPrep.create({
      data: {
        userId,
        nutritionistPlanId: dto.nutritionistPlanId || null,
        weekStartDate: dto.weekStartDate,
        weekEndDate,
        name: dto.name || `Semana del ${this.formatDateShort(dto.weekStartDate)}`,
        days: JSON.parse(JSON.stringify(dto.days)),
        dailyTotals: JSON.parse(JSON.stringify(totals.dailyTotals)),
        weeklyTotals: JSON.parse(JSON.stringify(totals.weeklyTotals)),
        status: 'active',
      },
    });
  }

  async generateMealPrep(dto: GenerateMealPrepDto, userId: string) {
    if (!this.openai) {
      throw new BadRequestException('OpenAI API key no configurada');
    }

    // Fetch datos en paralelo
    const [activePlan, savedMeals, preferences] = await Promise.all([
      dto.nutritionistPlanId
        ? this.prisma.nutritionistPlan.findFirst({
            where: { id: dto.nutritionistPlanId, userId },
          })
        : this.getActiveNutritionistPlan(userId),
      this.savedMealsService.getAll(userId),
      this.prisma.userPreferences.findFirst({ where: { userId } }),
    ]);

    // Generar con IA
    const { week, completion } = await this.generateWeeklyPrepWithAI(
      dto,
      activePlan,
      savedMeals,
      preferences,
    );

    // Log AI cost
    try {
      await this.aiCostService.logFromCompletion(
        userId,
        'meal-prep-generate',
        completion,
      );
    } catch (e) {
      console.error('Error logging AI cost:', e);
    }

    // Aplicar fixed slots
    if (dto.fixedSlots?.length) {
      for (const fixed of dto.fixedSlots) {
        if (week.days[fixed.day]?.slots) {
          if (fixed.customSlot) {
            week.days[fixed.day].slots[fixed.mealType] = {
              ...(week.days[fixed.day].slots[fixed.mealType] || {}),
              ...fixed.customSlot,
              isFixed: true,
            } as any;
          }
        }
      }
    }

    const weekEndDate = this.calculateWeekEndDate(dto.weekStartDate);
    const totals = this.computeTotals(week);

    // Archivar prep activo de la misma semana
    await this.prisma.mealPrep.updateMany({
      where: {
        userId,
        status: 'active',
        weekStartDate: dto.weekStartDate,
      },
      data: { status: 'archived' },
    });

    return this.prisma.mealPrep.create({
      data: {
        userId,
        nutritionistPlanId: activePlan?.id || null,
        weekStartDate: dto.weekStartDate,
        weekEndDate,
        name: `Semana del ${this.formatDateShort(dto.weekStartDate)}`,
        days: JSON.parse(JSON.stringify(week)),
        dailyTotals: JSON.parse(JSON.stringify(totals.dailyTotals)),
        weeklyTotals: JSON.parse(JSON.stringify(totals.weeklyTotals)),
        userContext: dto.userContext || null,
        status: 'active',
      },
    });
  }

  async updateMealPrep(id: string, dto: UpdateMealPrepDto, userId: string) {
    const existing = await this.prisma.mealPrep.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException('Meal prep no encontrado');
    }

    const updateData: any = { updatedAt: new Date() };

    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.days) {
      updateData.days = JSON.parse(JSON.stringify(dto.days));
      const totals = this.computeTotals(dto.days);
      updateData.dailyTotals = JSON.parse(JSON.stringify(totals.dailyTotals));
      updateData.weeklyTotals = JSON.parse(
        JSON.stringify(totals.weeklyTotals),
      );
    }

    return this.prisma.mealPrep.update({
      where: { id },
      data: updateData,
    });
  }

  async updateSlot(id: string, dto: UpdateSlotDto, userId: string) {
    const existing = await this.prisma.mealPrep.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException('Meal prep no encontrado');
    }

    const days = existing.days as any as MealPrepWeek;

    if (!days.days[dto.day]) {
      throw new BadRequestException(`Día inválido: ${dto.day}`);
    }

    // Mergear el slot
    days.days[dto.day].slots[dto.mealType] = {
      ...(days.days[dto.day].slots[dto.mealType] || {}),
      ...dto.slot,
    } as any;

    const totals = this.computeTotals(days);

    return this.prisma.mealPrep.update({
      where: { id },
      data: {
        days: JSON.parse(JSON.stringify(days)),
        dailyTotals: JSON.parse(JSON.stringify(totals.dailyTotals)),
        weeklyTotals: JSON.parse(JSON.stringify(totals.weeklyTotals)),
        updatedAt: new Date(),
      },
    });
  }

  async markSlotEaten(id: string, dto: MarkSlotEatenDto, userId: string) {
    const existing = await this.prisma.mealPrep.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException('Meal prep no encontrado');
    }

    const days = existing.days as any as MealPrepWeek;
    const slot = days.days[dto.day]?.slots?.[dto.mealType];

    if (!slot) {
      throw new BadRequestException(
        `No hay comida planificada para ${dto.day} ${dto.mealType}`,
      );
    }

    if (slot.eatenAt) {
      throw new BadRequestException('Esta comida ya fue marcada como comida');
    }

    // Crear NutritionAnalysis real
    const nutritionAnalysis = await this.nutritionService.create(
      {
        date: dto.date,
        mealType: dto.mealType,
        foods: slot.foods || [],
        totalCalories: slot.totalCalories || 0,
        macronutrients: slot.macronutrients || {},
        aiConfidence: 0.9,
        context: `Meal prep: ${slot.name}`,
        savedMealId: slot.savedMealId || null,
      } as any,
      userId,
    );

    // Actualizar slot con timestamp y referencia
    slot.eatenAt = new Date().toISOString();
    slot.nutritionAnalysisId = nutritionAnalysis.id;

    const totals = this.computeTotals(days);

    const updatedMealPrep = await this.prisma.mealPrep.update({
      where: { id },
      data: {
        days: JSON.parse(JSON.stringify(days)),
        dailyTotals: JSON.parse(JSON.stringify(totals.dailyTotals)),
        weeklyTotals: JSON.parse(JSON.stringify(totals.weeklyTotals)),
        updatedAt: new Date(),
      },
    });

    return { mealPrep: updatedMealPrep, nutritionAnalysis };
  }

  async deleteMealPrep(id: string, userId: string): Promise<boolean> {
    const existing = await this.prisma.mealPrep.findFirst({
      where: { id, userId },
    });

    if (!existing) {
      throw new NotFoundException('Meal prep no encontrado');
    }

    await this.prisma.mealPrep.delete({ where: { id } });
    return true;
  }

  // ═══════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════

  private computeTotals(week: MealPrepWeek): {
    dailyTotals: Record<DayKey, MacroSummary>;
    weeklyTotals: MacroSummary;
  } {
    const dailyTotals: Record<string, MacroSummary> = {};
    const weeklyTotals: MacroSummary = {
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      fiber: 0,
    };

    for (const day of DAY_KEYS) {
      const dayData = week.days[day];
      const dayTotal: MacroSummary = {
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        fiber: 0,
      };

      if (dayData?.slots) {
        for (const mealKey of MEAL_SLOT_KEYS) {
          const slot = dayData.slots[mealKey];
          if (slot) {
            dayTotal.calories += slot.totalCalories || 0;
            dayTotal.protein += slot.macronutrients?.protein || 0;
            dayTotal.carbs += slot.macronutrients?.carbs || 0;
            dayTotal.fat += slot.macronutrients?.fat || 0;
            dayTotal.fiber += slot.macronutrients?.fiber || 0;
          }
        }
      }

      dailyTotals[day] = dayTotal;
      weeklyTotals.calories += dayTotal.calories;
      weeklyTotals.protein += dayTotal.protein;
      weeklyTotals.carbs += dayTotal.carbs;
      weeklyTotals.fat += dayTotal.fat;
      weeklyTotals.fiber += dayTotal.fiber;
    }

    return { dailyTotals: dailyTotals as Record<DayKey, MacroSummary>, weeklyTotals };
  }

  private calculateWeekEndDate(weekStartDate: string): string {
    const start = new Date(weekStartDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return end.toISOString().split('T')[0];
  }

  private formatDateShort(dateStr: string): string {
    // Parse YYYY-MM-DD without timezone issues
    const [, monthStr, dayStr] = dateStr.split('-');
    const day = parseInt(dayStr, 10);
    const monthIndex = parseInt(monthStr, 10) - 1;
    const months = [
      'Ene',
      'Feb',
      'Mar',
      'Abr',
      'May',
      'Jun',
      'Jul',
      'Ago',
      'Sep',
      'Oct',
      'Nov',
      'Dic',
    ];
    return `${day} ${months[monthIndex]}`;
  }

  private cleanOpenAIResponse(response: string): string {
    return response
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
  }

  // ═══════════════════════════════════════════════════════════
  // AI METHODS
  // ═══════════════════════════════════════════════════════════

  private async parsePdfWithAI(images: string[]): Promise<{
    parsedPlan: any;
    rawText: string | null;
    confidence: number;
    completion: any;
  }> {
    if (!this.openai) {
      throw new BadRequestException('OpenAI API key no configurada');
    }

    const imageContents = images.map((img) => ({
      type: 'image_url' as const,
      image_url: { url: resolveImageUrl(img), detail: 'high' as const },
    }));

    const prompt = `Eres un nutricionista experto. Analiza estas imágenes de un plan nutricional de un profesional (PDF escaneado) y extrae la estructura completa del plan.

El plan puede contener:
- Plan semanal con días de la semana
- Comidas del día: desayuno, almuerzo, merienda, cena
- Alimentos con cantidades específicas
- Calorías estimadas por comida o totales diarios
- Restricciones alimentarias o notas generales
- Objetivos calóricos y de macronutrientes

INSTRUCCIONES:
1. Extrae los alimentos con sus cantidades exactas tal como aparecen
2. Si un día/comida no aparece, usa null
3. Si el plan repite días (por ejemplo "Lunes a Viernes igual"), duplica la información para cada día
4. estimatedCalories puede ser null si no aparece en el PDF

Responde ÚNICAMENTE con un JSON válido (sin bloques de código markdown):
{
  "days": {
    "monday": {
      "breakfast": { "name": "string", "description": "string|null", "foods": ["string"], "estimatedCalories": "number|null", "notes": "string|null" },
      "lunch": { ... } ,
      "snack": { ... } ,
      "dinner": { ... }
    },
    "tuesday": { ... },
    "wednesday": { ... },
    "thursday": { ... },
    "friday": { ... },
    "saturday": { ... },
    "sunday": { ... }
  },
  "generalNotes": "string|null",
  "restrictions": ["string"],
  "targetCalories": "number|null",
  "targetMacros": { "protein": "number|null", "carbs": "number|null", "fat": "number|null", "fiber": "number|null" }
}`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...imageContents],
        },
      ],
      max_tokens: 4000,
      temperature: 0.1,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new BadRequestException('OpenAI no devolvió contenido');
    }

    const cleaned = this.cleanOpenAIResponse(content);

    try {
      const parsedPlan = JSON.parse(cleaned);
      return {
        parsedPlan,
        rawText: content,
        confidence: 0.85,
        completion,
      };
    } catch (e) {
      console.error('Error parseando respuesta PDF:', cleaned);
      throw new BadRequestException(
        'Error parseando la respuesta del análisis del PDF',
      );
    }
  }

  private async generateWeeklyPrepWithAI(
    dto: GenerateMealPrepDto,
    activePlan: any | null,
    savedMeals: any[],
    preferences: any | null,
  ): Promise<{ week: MealPrepWeek; completion: any }> {
    if (!this.openai) {
      throw new BadRequestException('OpenAI API key no configurada');
    }

    // Construir prompt dinámico
    const parts: string[] = [];

    parts.push(
      `Crea un plan semanal de meal prep para la semana que comienza el ${dto.weekStartDate}.`,
    );

    if (activePlan?.parsedPlan) {
      const planJson = JSON.stringify(activePlan.parsedPlan);
      // Si el plan es muy largo, resumir
      if (planJson.length > 3000) {
        const plan = activePlan.parsedPlan;
        parts.push(`\nPLAN BASE DEL NUTRICIONISTA (resumen):
- Calorías objetivo: ${plan.targetCalories || 'no especificado'}
- Macros: ${JSON.stringify(plan.targetMacros || {})}
- Notas: ${plan.generalNotes || 'ninguna'}
- Restricciones: ${(plan.restrictions || []).join(', ') || 'ninguna'}`);
      } else {
        parts.push(
          `\nPLAN BASE DEL NUTRICIONISTA:\n${planJson}`,
        );
      }
    }

    if (preferences) {
      parts.push(`\nOBJETIVOS DEL USUARIO:
- Calorías diarias objetivo: ${preferences.dailyCalorieGoal || 2000} kcal
- Proteínas: ${preferences.proteinGoal || 120}g | Carbohidratos: ${preferences.carbsGoal || 200}g | Grasas: ${preferences.fatGoal || 70}g`);
    }

    if (dto.userContext) {
      parts.push(`\nCONTEXTO DEL USUARIO:\n${dto.userContext}`);
    }

    if (savedMeals.length > 0) {
      const mealList = savedMeals
        .slice(0, 15) // Limitar para no exceder tokens
        .map(
          (m: any) =>
            `- [${m.id}] ${m.name} (${m.mealType}): ${m.totalCalories} kcal, P:${m.macronutrients?.protein || 0}g C:${m.macronutrients?.carbs || 0}g G:${m.macronutrients?.fat || 0}g`,
        )
        .join('\n');
      parts.push(
        `\nCOMIDAS GUARDADAS DISPONIBLES (usar cuando sea apropiado, indicar savedMealId):\n${mealList}`,
      );
    }

    if (dto.fixedSlots?.length) {
      const fixedList = dto.fixedSlots
        .map((s) => `- ${s.day} ${s.mealType}: ${s.savedMealId || 'personalizado'}`)
        .join('\n');
      parts.push(`\nSLOTS FIJOS (no modificar):\n${fixedList}`);
    }

    parts.push(`\nPara cada comida incluye alimentos con cantidades en gramos, calorías y macronutrientes.
Si una comida guardada del usuario es apropiada, úsala (indica savedMealId).

Responde ÚNICAMENTE con un JSON válido (sin bloques de código markdown):
{
  "days": {
    "monday": {
      "slots": {
        "breakfast": {
          "name": "string",
          "foods": [{ "name": "string", "quantity": "string", "calories": 0, "confidence": 0.85, "macronutrients": { "protein": 0, "carbs": 0, "fat": 0, "fiber": 0 }, "category": "string" }],
          "totalCalories": 0,
          "macronutrients": { "protein": 0, "carbs": 0, "fat": 0, "fiber": 0 },
          "notes": "string|null",
          "savedMealId": "string|null"
        },
        "lunch": { ... },
        "snack": { ... },
        "dinner": { ... }
      }
    },
    "tuesday": { ... },
    "wednesday": { ... },
    "thursday": { ... },
    "friday": { ... },
    "saturday": { ... },
    "sunday": { ... }
  }
}`);

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'Eres un nutricionista y chef experto en meal prep. Tu tarea es crear un plan de comidas semanal estructurado, nutritivo y práctico. Las comidas deben ser realistas, variadas y alineadas con el plan base del nutricionista cuando se proporcione.',
        },
        {
          role: 'user',
          content: parts.join('\n'),
        },
      ],
      max_tokens: 6000,
      temperature: 0.3,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new BadRequestException('OpenAI no devolvió contenido');
    }

    const cleaned = this.cleanOpenAIResponse(content);

    try {
      const parsed = JSON.parse(cleaned) as MealPrepWeek;
      return { week: parsed, completion };
    } catch (e) {
      console.error('Error parseando respuesta meal prep:', cleaned);
      throw new BadRequestException(
        'Error parseando la respuesta de generación del meal prep',
      );
    }
  }
}
