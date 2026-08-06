import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../../config/prisma.service';
import { AICostService } from '../ai-cost/ai-cost.service';

/**
 * Categorización automática de gastos. Todo gasto que entra sin categoría
 * (MP sync, quick actions, MCP, manual) pasa por acá:
 *   1. Reglas por comercio (gratis, instantáneo)
 *   2. Historial: un gasto previo parecido ya categorizado por Luciano
 *      (así el sistema aprende de sus correcciones)
 *   3. IA (gpt-4o-mini) con umbral de confianza — si duda, queda sin categoría
 */

// Reglas comercio/keyword → nombre canónico de categoría
export const CATEGORY_RULES: [RegExp, string][] = [
  [
    /peaje|ausa|ausol|gco\b|ceamse|autopista|sube\b|ypf|shell|axion|puma|nafta|estacionamiento|uber|cabify|didi|tren|colectivo/i,
    'Transporte',
  ],
  [
    /mcdonald|burger|mostaza|wendy|rappi|pedidosya|restaurant|parrilla|cafe|café|pizzer|heladeri|kiosco|panaderi|sushi|bar\b/i,
    'Comida',
  ],
  [
    /meli\+|netflix|spotify|disney|hbo|max\b|prime|youtube|icloud|google one|chatgpt|openai|claude|anthropic|suscripci|gympass/i,
    'Suscripciones',
  ],
  [
    /coto|carrefour|jumbo|vea\b|dia\b|chango|supermercado|autoservicio|almacen|almacén|verduler|carnicer|granja|dietetic/i,
    'Supermercado',
  ],
  [
    /farmacia|farmacity|hospital|medic|dentista|odontolog|psicolog|nutricionista|kinesiolog|kinesi|laboratorio|obra social/i,
    'Salud',
  ],
  [/handball|club\b|gimnasio|gym\b|calistenia|deporte|cancha|torneo/i, 'Deporte'],
  [
    /alquiler|expensas|edesur|edenor|metrogas|aysa|abl\b|internet|fibertel|flow\b|telecentro|movistar|claro\b|personal\b|ferreter|pintur/i,
    'Hogar',
  ],
  [/filamento|bambu|impresion 3d|impresión 3d|pla\b|petg|3d\b/i, 'Impresión 3D'],
  [/regalo|cumpleaños|cumple\b|juguetería|jugueteria/i, 'Regalos'],
  [/meridional|seguro automotor|seguro del auto/i, 'Transporte'],
  [/tuenti/i, 'Hogar'],
  [/liomac/i, 'Salidas'],
  [/comisi[oó]n|mantenimiento de cuenta|cargo por servicio/i, 'Comisiones'],
  [/zapatill|nike\b|adidas|indumentaria|dexter|solodeportes|moov\b|ropa\b/i, 'Ropa'],
];

export function matchCategoryByRules(description: string): string | null {
  for (const [re, name] of CATEGORY_RULES) {
    if (re.test(description)) return name;
  }
  return null;
}

/** Baja a minúsculas y saca los sufijos/prefijos de la importación de MP. */
export function normalizeDescription(description: string): string {
  return description
    .toLowerCase()
    .replace(/\s*\(mp\)\s*$/i, '')
    .replace(/^transferencia a\s*/i, '')
    .replace(/\s*-\s*(pago en tienda|pago automático|compra).*$/i, '')
    .trim();
}

export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
  source: 'reglas' | 'historial' | 'ia';
  confidence: number;
}

const AI_CONFIDENCE_THRESHOLD = 0.6;

@Injectable()
export class ExpenseCategorizerService {
  private readonly logger = new Logger(ExpenseCategorizerService.name);
  private openai: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
    private aiCost: AICostService,
  ) {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  async categorize(
    userId: string,
    description: string,
  ): Promise<CategorySuggestion | null> {
    const cats = await this.prisma.expenseCategory.findMany({
      where: { userId },
    });
    if (!cats.length) return null;
    const byName = (n: string) =>
      cats.find((c) => c.name.toLowerCase() === n.toLowerCase()) ||
      cats.find((c) => c.name.toLowerCase().includes(n.toLowerCase()));

    // 1) Reglas por comercio
    const ruleName = matchCategoryByRules(description);
    if (ruleName) {
      const cat = byName(ruleName);
      if (cat) {
        return {
          categoryId: cat.id,
          categoryName: cat.name,
          source: 'reglas',
          confidence: 0.95,
        };
      }
    }

    // 2) Historial: mismo destinatario/comercio ya categorizado antes
    const core = normalizeDescription(description);
    if (core.length >= 4) {
      const prev = await this.prisma.expense.findFirst({
        where: {
          userId,
          categoryId: { not: null },
          description: { contains: core },
        },
        orderBy: { updatedAt: 'desc' },
      });
      if (prev?.categoryId) {
        const cat = cats.find((c) => c.id === prev.categoryId);
        if (cat) {
          return {
            categoryId: cat.id,
            categoryName: cat.name,
            source: 'historial',
            confidence: 0.9,
          };
        }
      }
    }

    // 3) IA barata con umbral: si duda, mejor sin categoría que una inventada
    if (!this.openai) return null;
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: `Categorizás gastos personales de Argentina. Opciones EXACTAS: ${cats
              .map((c) => c.name)
              .join(
                ', ',
              )}. Si el gasto no da información clara del rubro (ej: una transferencia a una persona desconocida), respondé confidence baja. Respondé SOLO JSON: {"category": "nombre exacto o null", "confidence": 0.0-1.0}`,
          },
          { role: 'user', content: description },
        ],
      });
      try {
        await this.aiCost.logFromCompletion(
          userId,
          'expense-categorizer',
          completion as any,
          'gpt-4o-mini',
        );
      } catch {
        // no crítico
      }
      const raw = completion.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(raw.replace(/```json?|```/g, '').trim());
      if (
        parsed.category &&
        typeof parsed.confidence === 'number' &&
        parsed.confidence >= AI_CONFIDENCE_THRESHOLD
      ) {
        const cat = byName(parsed.category);
        if (cat) {
          return {
            categoryId: cat.id,
            categoryName: cat.name,
            source: 'ia',
            confidence: parsed.confidence,
          };
        }
      }
    } catch (error) {
      this.logger.warn(`IA de categorización falló: ${(error as Error).message}`);
    }
    return null;
  }

  /** Categoriza los gastos sin categoría (de un mes o todos). */
  async backfill(
    userId: string,
    opts: { month?: string; dryRun?: boolean },
  ): Promise<{
    procesados: number;
    categorizados: number;
    detalles: {
      id: string;
      date: string;
      amount: number;
      description: string;
      categoria: string | null;
      fuente: string | null;
    }[];
  }> {
    const expenses = await this.prisma.expense.findMany({
      where: {
        userId,
        categoryId: null,
        ...(opts.month
          ? { date: { gte: `${opts.month}-01`, lte: `${opts.month}-31` } }
          : {}),
      },
      orderBy: { date: 'desc' },
    });

    const detalles: {
      id: string;
      date: string;
      amount: number;
      description: string;
      categoria: string | null;
      fuente: string | null;
    }[] = [];
    let categorizados = 0;

    for (const e of expenses) {
      const sug = await this.categorize(userId, e.description);
      if (sug) {
        if (!opts.dryRun) {
          await this.prisma.expense.update({
            where: { id: e.id },
            data: { categoryId: sug.categoryId },
          });
        }
        categorizados++;
      }
      detalles.push({
        id: e.id,
        date: e.date,
        amount: e.amount,
        description: e.description,
        categoria: sug?.categoryName || null,
        fuente: sug?.source || null,
      });
    }

    return { procesados: expenses.length, categorizados, detalles };
  }
}
