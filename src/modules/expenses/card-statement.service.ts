import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { PrismaService } from '../../config/prisma.service';
import { AICostService } from '../ai-cost/ai-cost.service';
import { ExpenseCategorizerService } from './expense-categorizer.service';

/**
 * Importador de resúmenes de tarjeta de crédito (mismo patrón que el plan
 * del nutricionista y la antropometría): PDF → imágenes → OpenAI Vision →
 * desglose de consumos con categoría sugerida y detección de duplicados →
 * el usuario revisa y confirma → gastos con dedup por línea.
 */

export interface ParsedMovement {
  date: string; // fecha del consumo YYYY-MM-DD
  description: string;
  amountArs: number;
  installment: string | null; // "3/6" si es cuota
  isTax: boolean;
  categoria?: string | null; // sugerida por el categorizador
  categoryId?: string | null;
  duplicate?: boolean; // ya hay un gasto con ese monto en el período
}

export interface ParsedStatement {
  bank: string;
  cardLabel: string;
  closingDate: string;
  dueDate: string;
  totalArs: number;
  totalUsd: number;
  movements: ParsedMovement[];
  statementKey: string;
}

@Injectable()
export class CardStatementService {
  private readonly logger = new Logger(CardStatementService.name);
  private openai: OpenAI | null = null;

  constructor(
    private prisma: PrismaService,
    private aiCost: AICostService,
    private categorizer: ExpenseCategorizerService,
  ) {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
  }

  async parseStatement(
    userId: string,
    images: string[],
  ): Promise<ParsedStatement> {
    if (!images || images.length === 0) {
      throw new BadRequestException(
        'Se requiere al menos una imagen del PDF del resumen',
      );
    }
    if (!this.openai) {
      throw new BadRequestException('OpenAI API key no configurada');
    }

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.1,
      max_tokens: 4000,
      messages: [
        {
          role: 'system',
          content: `Sos un parser de resúmenes de tarjeta de crédito argentinos (Visa/Mastercard de cualquier banco). Extraé SOLO los movimientos del período actual del resumen.

INCLUIR en movements:
- Cada consumo del período: fecha real del consumo, comercio tal cual figura, monto en pesos (positivo)
- Consumos en cuotas: el monto de la cuota del período, con installment "3/6" (cuota/total)
- Impuestos, percepciones e intereses del cierre (IVA, IIBB, RG, sellos): isTax true

NO incluir:
- Pagos del período ("SU PAGO EN PESOS/USD") ni el saldo anterior
- Consumos en dólares (van aparte en totalUsd)

Respondé SOLO un JSON válido sin markdown:
{"bank": "string", "cardLabel": "string", "closingDate": "YYYY-MM-DD", "dueDate": "YYYY-MM-DD", "totalArs": number, "totalUsd": number, "movements": [{"date": "YYYY-MM-DD", "description": "string", "amountArs": number, "installment": "string|null", "isTax": boolean}]}`,
        },
        {
          role: 'user',
          content: images.map((img) => ({
            type: 'image_url' as const,
            image_url: { url: `data:image/jpeg;base64,${img}`, detail: 'high' as const },
          })),
        },
      ],
    });

    try {
      await this.aiCost.logFromCompletion(
        userId,
        'card-statement-import',
        completion as any,
      );
    } catch {
      // no crítico
    }

    const raw = completion.choices[0]?.message?.content || '{}';
    let parsed: any;
    try {
      parsed = JSON.parse(raw.replace(/```json?|```/g, '').trim());
    } catch {
      throw new BadRequestException(
        'No se pudo interpretar el resumen — probá de nuevo o con mejor calidad de PDF',
      );
    }
    if (!Array.isArray(parsed.movements) || parsed.movements.length === 0) {
      throw new BadRequestException(
        'No se encontraron movimientos en el resumen',
      );
    }

    // Sugerir categoría + marcar posibles duplicados contra lo ya cargado
    const monthStart = (parsed.closingDate || '').slice(0, 7);
    const movements: ParsedMovement[] = [];
    for (const m of parsed.movements) {
      const sug = await this.categorizer
        .categorize(userId, String(m.description || ''))
        .catch(() => null);
      const dup = await this.prisma.expense.findFirst({
        where: {
          userId,
          amount: Number(m.amountArs),
          ...(monthStart
            ? { date: { gte: `${monthStart}-01` } }
            : {}),
        },
      });
      movements.push({
        date: m.date,
        description: String(m.description || 'Consumo'),
        amountArs: Number(m.amountArs) || 0,
        installment: m.installment || null,
        isTax: !!m.isTax,
        categoria: sug?.categoryName || null,
        categoryId: sug?.categoryId || null,
        duplicate: !!dup,
      });
    }

    const statementKey = `${String(parsed.bank || 'tarjeta').toLowerCase().replace(/\s+/g, '-')}-${parsed.closingDate || 'sin-fecha'}`;

    return {
      bank: parsed.bank || 'Tarjeta',
      cardLabel: parsed.cardLabel || '',
      closingDate: parsed.closingDate || '',
      dueDate: parsed.dueDate || '',
      totalArs: Number(parsed.totalArs) || 0,
      totalUsd: Number(parsed.totalUsd) || 0,
      movements,
      statementKey,
    };
  }

  /** Crea los gastos confirmados, fechados al vencimiento, con dedup doble. */
  async confirmImport(
    userId: string,
    dto: {
      statementKey: string;
      dueDate: string;
      movements: {
        date?: string;
        description: string;
        amount: number;
        categoryId?: string | null;
      }[];
    },
  ): Promise<{ imported: number; skipped: number }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dto.dueDate || '')) {
      throw new BadRequestException('Fecha de vencimiento inválida');
    }
    if (!dto.movements?.length) {
      throw new BadRequestException('No hay movimientos para importar');
    }

    let imported = 0;
    let skipped = 0;
    for (let i = 0; i < dto.movements.length; i++) {
      const m = dto.movements[i];
      const externalId = `card:${dto.statementKey}:${i}`;
      const byId = await this.prisma.expense.findFirst({
        where: { userId, externalId },
      });
      if (byId) {
        skipped++;
        continue;
      }
      // Heurística anti-duplicado: mismo monto ya cargado en fechas cercanas
      const similar = await this.prisma.expense.findFirst({
        where: {
          userId,
          amount: m.amount,
          date: { gte: dto.dueDate.slice(0, 7) + '-01' },
          externalId: { not: externalId },
        },
      });
      if (similar) {
        skipped++;
        continue;
      }
      // Si el consumo ya estaba como tarjeta-pendiente (lo trajo el MP sync
      // durante el período), el gasto del resumen lo reemplaza
      await this.prisma.expense.deleteMany({
        where: { userId, source: 'tarjeta-pendiente', amount: m.amount },
      });
      await this.prisma.expense.create({
        data: {
          userId,
          date: dto.dueDate,
          amount: m.amount,
          description: `${m.description} - Visa${m.date ? ` (consumo ${m.date})` : ''}`,
          categoryId: m.categoryId || null,
          source: 'tarjeta',
          externalId,
        },
      });
      imported++;
    }
    return { imported, skipped };
  }
}
