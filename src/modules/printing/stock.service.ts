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
import { assertPaletteColor } from './colors';
import { PartsService } from './parts.service';

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
  plateKey?: string;
  notes?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Consumo corregido a mano: color de la paleta o rollo exacto. */
export interface ReassignEntryDto {
  color?: string;
  filamentId?: string;
  grams?: number; // sin esto (y con un solo consumo) se mantienen los gramos
}

/** Serie de Bambu -> nombre de la impresora (el sync guarda "Impresora <serie>"). */
export function printerName(notes?: string | null): string | null {
  const serial = notes?.match(/Impresora (\S+)/)?.[1];
  if (!serial) return null;
  if (serial.startsWith('030')) return 'A1 Mini';
  if (serial.startsWith('01P')) return 'P1S';
  return serial;
}

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly parts: PartsService,
  ) {}

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

  /**
   * Impresiones con lo que descontaron (rollo, color, gramos) y la impresora,
   * para poder ver si el sync se equivoco de color y corregirlo.
   */
  async listJobs(userId: string, limit = 60) {
    const [jobs, filaments] = await Promise.all([
      this.prisma.printJob.findMany({
        where: { userId },
        include: { product: true },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: limit,
      }),
      this.activeFilaments(userId),
    ]);
    const byId = new Map(filaments.map((f) => [f.id, f]));
    // Piezas que sumo cada impresion (stock de piezas).
    const moves = await this.prisma.printPartMove.findMany({
      where: { userId, reason: 'impresion', jobId: { in: jobs.map((j: any) => j.id) } },
      include: { part: true },
    });
    const partsByJob = new Map<string, any[]>();
    for (const m of moves as any[]) {
      partsByJob.set(m.jobId, [
        ...(partsByJob.get(m.jobId) ?? []),
        { partId: m.partId, partName: m.part?.name ?? null, color: m.color, qty: m.qty },
      ]);
    }
    return jobs.map((j: any) => ({
      partsAdded: partsByJob.get(j.id) ?? [],
      ...j,
      printer: printerName(j.notes),
      deducted: ((j.appliedPlan ?? []) as DeductionStep[]).map((step) => {
        const roll = byId.get(step.filamentId);
        return {
          filamentId: step.filamentId,
          grams: step.grams,
          color: roll?.color ?? null,
          brand: roll?.brand ?? null,
          material: roll?.material ?? null,
        };
      }),
    }));
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
        plateKey: dto.plateKey || null,
        status: dto.status ?? 'ok',
        notes: dto.notes || null,
      },
    });
    if (job.status === 'ok' && entries.length && dto.apply !== false) {
      const applied = await this.applyJob(userId, job.id);
      return {
        job: applied.job,
        applied: applied.applied,
        unmatchedGrams: applied.unmatchedGrams,
      };
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
      throw new BadRequestException(
        'El stock de esta impresion ya se desconto',
      );
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

  /** Devuelve a cada rollo lo que el job le habia descontado. */
  private async revertJob(
    userId: string,
    job: { stockApplied: boolean; appliedPlan: unknown },
  ) {
    if (!job.stockApplied || !job.appliedPlan) return;
    for (const step of job.appliedPlan as DeductionStep[]) {
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

  /** Borra una impresion devolviendo al stock lo que habia descontado. */
  async deleteJob(userId: string, jobId: string) {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) throw new NotFoundException('Impresion no encontrada');
    await this.revertJob(userId, job);
    await this.parts.removeJob(userId, jobId);
    await this.prisma.printJob.delete({ where: { id: jobId } });
    return true;
  }

  /**
   * Corrige de que color (o rollo) salio una impresion: devuelve lo que se
   * desconto y vuelve a descontar con los consumos nuevos. Caso tipico: el
   * slot de la A1 Mini tenia cargado el color viejo y Bambu reporto verde
   * cuando se imprimio en rojo. El hex que reporto Bambu se guarda como
   * `reportedHex` (informativo) y deja de usarse para matchear.
   */
  async reassignJob(
    userId: string,
    jobId: string,
    entries: ReassignEntryDto[],
    opts?: { learnHex?: boolean },
  ) {
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) throw new NotFoundException('Impresion no encontrada');
    if (!entries?.length) {
      throw new BadRequestException('Pasame al menos un consumo');
    }
    const old = ((job.filamentsUsed as any) ?? []) as NeedItem[];
    if (entries.some((e) => e.grams === undefined) && old.length !== 1) {
      throw new BadRequestException(
        'La impresion tiene varios consumos: pasame los gramos de cada uno',
      );
    }

    // Validar TODO antes de tocar el stock.
    const next: any[] = [];
    for (const [i, e] of entries.entries()) {
      const grams = e.grams ?? old[0].grams;
      if (!Number.isFinite(grams) || grams <= 0) {
        throw new BadRequestException('Los gramos deben ser mayor a 0');
      }
      const item: any = { grams };
      if (e.filamentId) {
        const roll = await this.prisma.filament.findFirst({
          where: { id: e.filamentId, userId },
        });
        if (!roll) throw new NotFoundException('Rollo no encontrado');
        item.filamentId = roll.id;
      } else {
        item.color = assertPaletteColor(e.color);
      }
      const reportedHex =
        (old[i] as any)?.reportedHex ?? old[i]?.colorHex ?? undefined;
      if (reportedHex) item.reportedHex = reportedHex;
      next.push(item);
    }

    await this.revertJob(userId, job);
    await this.prisma.printJob.update({
      where: { id: job.id },
      data: { filamentsUsed: next, stockApplied: false, appliedPlan: [] },
    });
    const learned = opts?.learnHex ? await this.learnHexes(userId, next) : [];
    if (job.status !== 'ok') {
      return { job, applied: [], unmatchedGrams: 0, learned };
    }
    const res = await this.applyJob(userId, job.id);
    // Las piezas que sumo la impresion cambian de color con la correccion.
    await this.parts.recomputeJob(userId, job.id);
    return { ...res, learned };
  }

  /**
   * "Recordar este color": el hex que reporto Bambu queda en todos los rollos
   * vivos del color corregido, y se le saca a los rollos vivos de OTRO color
   * que lo tenian (un hex apunta a un solo color, sino matchea dos). Asi la
   * proxima impresion de ese rollo se descuenta sola del color correcto.
   * Se compara en JS: en la base conviven "#ff7900", "#FF671F", "00BB31FF".
   */
  private async learnHexes(userId: string, entries: any[]) {
    const active = (await this.activeFilaments(userId)).filter(
      (f) => !f.discarded && !f.finishedAt,
    );
    const learned: {
      color: string;
      hex: string;
      rolls: number;
      removedFrom: string[];
    }[] = [];
    for (const e of entries) {
      const h6 = normHex(e.reportedHex);
      const color = e.filamentId
        ? normColor(active.find((f) => f.id === e.filamentId)?.color)
        : normColor(e.color);
      if (!h6 || !color) continue;
      const others = active.filter(
        (f) => normHex(f.colorHex) === h6 && normColor(f.color) !== color,
      );
      if (others.length) {
        await this.prisma.filament.updateMany({
          where: { id: { in: others.map((f) => f.id) }, userId },
          data: { colorHex: null },
        });
      }
      const mine = active.filter((f) => normColor(f.color) === color);
      if (!mine.length) continue;
      const hex = `#${h6.toUpperCase()}`;
      await this.prisma.filament.updateMany({
        where: { id: { in: mine.map((f) => f.id) }, userId },
        data: { colorHex: hex },
      });
      learned.push({
        color,
        hex,
        rolls: mine.length,
        removedFrom: [...new Set(others.map((f) => normColor(f.color)))],
      });
    }
    return learned;
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
      throw new BadRequestException(
        'La cantidad de unidades debe ser mayor a 0',
      );
    }
    const job = await this.prisma.printJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) throw new NotFoundException('Impresion no encontrada');
    if (!job.productId) {
      throw new BadRequestException(
        'Linkea la impresion a un producto primero',
      );
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
