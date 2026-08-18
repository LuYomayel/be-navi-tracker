import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import {
  buildStock,
  checkStock,
  countUntracked,
  normColor,
  normHex,
  planDeduction,
  DeductionStep,
  FilamentLike,
  NeedItem,
} from './stock';
import { getLocalDateString } from '../../common/utils/date.utils';

export interface CreatePrintJobDto {
  title: string;
  productId?: string;
  date?: string; // YYYY-MM-DD, default hoy
  grams?: number;
  hours?: number;
  filamentsUsed?: NeedItem[]; // [{ color?, colorHex?, grams, filamentId? }]
  apply?: boolean; // false = registrar sin descontar stock (ej: importar historial viejo)
  status?: 'ok' | 'fallida';
  source?: 'manual' | 'bambu';
  externalId?: string;
  notes?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Stock de filamento por color + impresiones (PrintJob).
 *
 * Cada impresion registrada (a mano o via el sync de Bambu) descuenta
 * gramsLeft de los rollos que matchean por color (FIFO, ver stock.ts). El
 * plan aplicado queda guardado en el job (appliedPlan) para poder revertir
 * si se borra.
 */
@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  private async activeFilaments(userId: string): Promise<FilamentLike[]> {
    return this.prisma.filament.findMany({ where: { userId } }) as Promise<
      FilamentLike[]
    >;
  }

  /** Stock disponible agrupado por color. */
  async getStock(userId: string) {
    const filaments = await this.activeFilaments(userId);
    return {
      colors: buildStock(filaments),
      untrackedRolls: countUntracked(filaments),
    };
  }

  /**
   * ¿Alcanza el stock para imprimir estos productos? Usa el desglose por
   * color del producto (x cantidad, con desperdicio). Los productos sin
   * desglose caen a un chequeo por gramos totales (mejor que nada) y se
   * listan aparte para que se note la diferencia.
   */
  async check(userId: string, items: { productId: string; qty: number }[]) {
    const [products, filaments, settings] = await Promise.all([
      this.prisma.printProduct.findMany({
        where: { userId, id: { in: items.map((i) => i.productId) } },
      }),
      this.activeFilaments(userId),
      this.prisma.printSettings.findUnique({ where: { userId } }),
    ]);
    const byId = new Map(products.map((p: any) => [p.id, p]));
    const waste = 1 + (settings?.wastePct ?? 0.15);

    const needs: NeedItem[] = [];
    const productsWithoutBreakdown: string[] = [];
    let fallbackNeeded = 0;

    for (const item of items) {
      const product: any = byId.get(item.productId);
      if (!product) throw new NotFoundException('Producto no encontrado');
      const breakdown = product.colorBreakdown as
        | { color?: string; colorHex?: string; grams: number }[]
        | null;
      if (breakdown?.length) {
        for (const entry of breakdown) {
          needs.push({
            color: entry.color,
            colorHex: entry.colorHex,
            grams: round1(entry.grams * item.qty * waste),
          });
        }
      } else {
        productsWithoutBreakdown.push(product.name);
        fallbackNeeded += round1(product.grams * item.qty * waste);
      }
    }

    const result = needs.length
      ? checkStock(needs, filaments)
      : { ok: true, perColor: [], untrackedRolls: countUntracked(filaments) };

    const totalAvailable = buildStock(filaments).reduce(
      (a, c) => a + c.totalGrams,
      0,
    );
    const fallback = productsWithoutBreakdown.length
      ? {
          needed: round1(fallbackNeeded),
          available: totalAvailable,
          ok: fallbackNeeded <= totalAvailable,
        }
      : null;

    return {
      ...result,
      ok: result.ok && (fallback ? fallback.ok : true),
      fallback,
      productsWithoutBreakdown,
    };
  }

  // ── Impresiones ───────────────────────────────────────────

  async listJobs(userId: string, limit = 60) {
    return this.prisma.printJob.findMany({
      where: { userId },
      include: { product: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    });
  }

  /** Registra una impresion y (si esta ok) descuenta el stock. */
  async createJob(userId: string, dto: CreatePrintJobDto) {
    if (!dto.title?.trim()) {
      throw new BadRequestException('Falta el nombre de la impresion');
    }
    const entries = (dto.filamentsUsed ?? []).filter(
      (e) => Number.isFinite(e.grams) && e.grams > 0,
    );
    const job = await this.prisma.printJob.create({
      data: {
        userId,
        productId: dto.productId || null,
        title: dto.title.trim(),
        date: dto.date || getLocalDateString(),
        grams:
          dto.grams ??
          (entries.length
            ? round1(entries.reduce((a, e) => a + e.grams, 0))
            : null),
        hours: dto.hours ?? null,
        filamentsUsed: entries.length ? (entries as any) : null,
        source: dto.source ?? 'manual',
        externalId: dto.externalId || null,
        status: dto.status ?? 'ok',
        notes: dto.notes || null,
      },
    });
    if (job.status === 'ok' && entries.length && dto.apply !== false) {
      const applied = await this.applyJob(userId, job.id);
      return { job: applied.job, applied: applied.applied, unmatchedGrams: applied.unmatchedGrams };
    }
    return { job, applied: [], unmatchedGrams: 0 };
  }

  /**
   * Descuenta del stock los consumos del job. Los planes se calculan entrada
   * por entrada sobre una copia en memoria que se va actualizando, para que
   * dos entradas del mismo color no descuenten el mismo gramo dos veces.
   */
  async applyJob(userId: string, jobId: string) {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) throw new NotFoundException('Impresion no encontrada');
    if (job.stockApplied) {
      throw new BadRequestException('El stock de esta impresion ya se desconto');
    }

    const entries = ((job.filamentsUsed as any) ?? []) as NeedItem[];
    const filaments = await this.activeFilaments(userId);
    const working = filaments.map((f) => ({ ...f }));

    const applied: DeductionStep[] = [];
    let unmatchedGrams = 0;
    for (const entry of entries) {
      const { plan, unmatchedGrams: um } = planDeduction(entry, working);
      unmatchedGrams += um;
      for (const step of plan) {
        applied.push(step);
        const roll = working.find((f) => f.id === step.filamentId)!;
        roll.gramsLeft = round1((roll.gramsLeft ?? 0) - step.grams);
      }
    }

    // Persistir los nuevos gramsLeft (uno por rollo tocado).
    const touched = new Set(applied.map((s) => s.filamentId));
    for (const filamentId of touched) {
      const roll = working.find((f) => f.id === filamentId)!;
      await this.prisma.filament.update({
        where: { id: filamentId },
        data: { gramsLeft: Math.max(0, roll.gramsLeft ?? 0) },
      });
    }

    const updated = await this.prisma.printJob.update({
      where: { id: job.id },
      data: { stockApplied: true, appliedPlan: applied as any },
    });
    return { job: updated, applied, unmatchedGrams: round1(unmatchedGrams) };
  }

  /** Borra una impresion devolviendo al stock lo que habia descontado. */
  async deleteJob(userId: string, jobId: string) {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) throw new NotFoundException('Impresion no encontrada');

    if (job.stockApplied && job.appliedPlan) {
      for (const step of job.appliedPlan as any as DeductionStep[]) {
        const roll = await this.prisma.filament.findFirst({
          where: { id: step.filamentId, userId },
        });
        if (roll && roll.gramsLeft !== null) {
          await this.prisma.filament.update({
            where: { id: roll.id },
            data: { gramsLeft: round1(roll.gramsLeft + step.grams) },
          });
        }
      }
    }
    await this.prisma.printJob.delete({ where: { id: jobId } });
    return true;
  }

  /** Linkea la impresion a un producto del catalogo (para aprender consumos). */
  async linkProduct(userId: string, jobId: string, productId: string | null) {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) throw new NotFoundException('Impresion no encontrada');
    if (productId) {
      const product = await this.prisma.printProduct.findFirst({
        where: { id: productId, userId },
      });
      if (!product) throw new NotFoundException('Producto no encontrado');
    }
    return this.prisma.printJob.update({
      where: { id: jobId },
      data: { productId },
    });
  }

  /**
   * Copia el consumo real por color del job al producto (dividido por la
   * cantidad de unidades que salieron de esa impresion). Con esto el chequeo
   * de stock deja de usar estimados.
   */
  async learnBreakdown(userId: string, jobId: string, units: number) {
    if (!Number.isFinite(units) || units <= 0) {
      throw new BadRequestException('La cantidad de unidades debe ser mayor a 0');
    }
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) throw new NotFoundException('Impresion no encontrada');
    if (!job.productId) {
      throw new BadRequestException('Linkea la impresion a un producto primero');
    }
    const entries = ((job.filamentsUsed as any) ?? []) as NeedItem[];
    if (!entries.length) {
      throw new BadRequestException('La impresion no tiene consumos cargados');
    }
    const breakdown = entries.map((e) => ({
      color: normColor(e.color) || null,
      colorHex: normHex(e.colorHex),
      grams: round1(e.grams / units),
    }));
    return this.prisma.printProduct.update({
      where: { id: job.productId },
      data: { colorBreakdown: breakdown as any },
    });
  }

  // ── Ciclo de vida de un rollo ─────────────────────────────

  /** "Se me termino el rollo": stock 0 y fecha de agotado. */
  async finishFilament(userId: string, filamentId: string, date?: string) {
    const roll = await this.prisma.filament.findFirst({
      where: { id: filamentId, userId },
    });
    if (!roll) throw new NotFoundException('Filamento no encontrado');
    return this.prisma.filament.update({
      where: { id: filamentId },
      data: { gramsLeft: 0, finishedAt: date || getLocalDateString() },
    });
  }
}
