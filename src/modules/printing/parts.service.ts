import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import {
  assertColorOrCombo,
  assertPaletteColor,
  canonicalColor,
} from './colors';
import {
  ColorMode,
  countBuildable,
  planConsumption,
  PlanOptions,
  RecipeLine,
  stockFromMoves,
} from './parts';
import { hexToColorName, normColor } from './stock';

/** Lo que salio de una impresion: N de una pieza, en un color o por cada color. */
export interface JobOutput {
  partId: string;
  qty: number;
  color?: string; // sin esto: el unico color de la impresion
  perColorLine?: boolean; // qty por CADA color que desconto la impresion
  combo?: boolean; // una pieza con TODOS los colores de la impresion (soporte River = rojo+blanco)
}

export interface SetRecipeDto {
  parts: { key: string; name: string }[];
  lines: {
    part: string; // key de la pieza
    qty: number;
    colorMode: ColorMode;
    fixedColor?: string;
    group?: string;
    slot?: string;
  }[];
}

export interface PartMoveDto {
  partId: string;
  color: string;
  qty: number;
  reason?: 'ajuste' | 'impresion';
  jobId?: string;
  notes?: string;
}

const COLOR_MODES: ColorMode[] = ['fijo', 'libre', 'juego', 'distintos'];

/**
 * Stock de piezas impresas (ver printing/parts.ts para las reglas de color).
 * Las piezas entran por impresion (a mano o por plantilla de placa en el
 * sync) y salen al entregar un pedido. Todo es un movimiento: el stock es
 * la suma, y revertir = borrar los movimientos de esa impresion / pedido.
 */
@Injectable()
export class PartsService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Lectura ───────────────────────────────────────────────

  private async stock(userId: string) {
    const moves = await this.prisma.printPartMove.findMany({
      where: { userId },
      select: { partId: true, color: true, qty: true },
    });
    return stockFromMoves(moves as any);
  }

  /** Por producto: receta, cuantas se pueden armar y que falta; + stock pieza x color. */
  async getSummary(userId: string) {
    const [products, parts, lines, stock] = await Promise.all([
      this.prisma.printProduct.findMany({
        where: { userId, recipe: { some: {} } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.printPart.findMany({ where: { userId } }),
      this.prisma.printRecipeLine.findMany({
        where: { product: { userId } },
        orderBy: { order: 'asc' },
      }),
      this.stock(userId),
    ]);
    const partNames = Object.fromEntries(parts.map((p: any) => [p.id, p.name]));
    const partById = new Map(parts.map((p: any) => [p.id, p]));
    return {
      products: products.map((prod: any) => {
        const pl = lines.filter((l: any) => l.productId === prod.id) as any[];
        const res = countBuildable(pl as RecipeLine[], stock, { partNames });
        return {
          productId: prod.id,
          productName: prod.name,
          parts: parts
            .filter((p: any) => p.productId === prod.id)
            .map((p: any) => ({ id: p.id, key: p.key, name: p.name })),
          lines: pl.map((l) => ({
            partId: l.partId,
            qty: l.qty,
            colorMode: l.colorMode,
            fixedColor: l.fixedColor,
            group: l.group,
            slot: l.slot,
          })),
          buildable: res.buildable,
          missing: res.missing,
        };
      }),
      stock: [...stock.entries()]
        .filter(([, qty]) => qty !== 0)
        .map(([k, qty]) => {
          const [partId, color] = k.split('|');
          const part: any = partById.get(partId);
          return {
            partId,
            partKey: part?.key ?? null,
            partName: part?.name ?? null,
            productId: part?.productId ?? null,
            color,
            qty,
          };
        }),
    };
  }

  // ── Receta ────────────────────────────────────────────────

  /** Reemplaza la receta del producto. Las piezas se crean/renombran por key (nunca se borran: tienen stock). */
  async setRecipe(userId: string, productId: string, dto: SetRecipeDto) {
    const product = await this.prisma.printProduct.findFirst({
      where: { id: productId, userId },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    const ids = new Map<string, string>();
    for (const p of dto.parts ?? []) {
      if (!p.key?.trim() || !p.name?.trim()) {
        throw new BadRequestException('Cada pieza necesita key y name');
      }
      const part = await this.prisma.printPart.upsert({
        where: { productId_key: { productId, key: p.key.trim() } },
        create: { userId, productId, key: p.key.trim(), name: p.name.trim() },
        update: { name: p.name.trim() },
      });
      ids.set(part.key, part.id);
    }
    const lines = (dto.lines ?? []).map((l, i) => {
      const partId = ids.get(l.part);
      if (!partId)
        throw new BadRequestException(
          `La linea ${i + 1} usa una pieza que no esta en parts: "${l.part}"`,
        );
      if (!Number.isInteger(l.qty) || l.qty <= 0) {
        throw new BadRequestException(
          `La linea ${i + 1} necesita qty entero > 0`,
        );
      }
      if (!COLOR_MODES.includes(l.colorMode)) {
        throw new BadRequestException(
          `colorMode invalido en la linea ${i + 1}: ${l.colorMode}`,
        );
      }
      if (l.colorMode === 'fijo' && !l.fixedColor) {
        throw new BadRequestException(
          `La linea ${i + 1} es fija y no tiene fixedColor`,
        );
      }
      return {
        productId,
        partId,
        qty: l.qty,
        colorMode: l.colorMode,
        fixedColor:
          l.colorMode === 'fijo' ? assertPaletteColor(l.fixedColor) : null,
        group: l.group ?? null,
        slot: l.slot ?? null,
        order: i,
      };
    });
    await this.prisma.printRecipeLine.deleteMany({ where: { productId } });
    if (lines.length)
      await this.prisma.printRecipeLine.createMany({ data: lines });
    return { parts: ids.size, lines: lines.length };
  }

  // ── Entradas ──────────────────────────────────────────────

  private async assertParts(userId: string, partIds: string[]) {
    const parts = await this.prisma.printPart.findMany({ where: { userId } });
    const mine = new Set(parts.map((p: any) => p.id));
    const bad = partIds.filter((id) => !mine.has(id));
    if (bad.length)
      throw new BadRequestException(`Pieza no encontrada: ${bad.join(', ')}`);
    return parts;
  }

  /** Ajuste manual (+/-) o carga suelta de piezas. */
  async addMoves(userId: string, moves: PartMoveDto[]) {
    if (!moves?.length)
      throw new BadRequestException('Pasame al menos un movimiento');
    await this.assertParts(
      userId,
      moves.map((m) => m.partId),
    );
    const data = moves.map((m) => {
      if (!Number.isInteger(m.qty) || m.qty === 0) {
        throw new BadRequestException(
          'La cantidad tiene que ser un entero distinto de 0',
        );
      }
      return {
        userId,
        partId: m.partId,
        color: assertColorOrCombo(m.color),
        qty: m.qty,
        reason: m.reason === 'impresion' ? 'impresion' : 'ajuste',
        jobId: m.jobId ?? null,
        notes: m.notes ?? null,
      };
    });
    await this.prisma.printPartMove.createMany({ data });
    return this.getSummary(userId);
  }

  /** Colores (canonicos) que desconto una impresion, en orden. */
  private async jobColors(userId: string, job: any): Promise<string[]> {
    const plan = (job.appliedPlan ?? []) as { filamentId: string }[];
    const colors: string[] = [];
    if (plan.length) {
      const filaments = await this.prisma.filament.findMany({
        where: { userId },
      });
      const byId = new Map(filaments.map((f: any) => [f.id, f]));
      for (const step of plan) {
        const f: any = byId.get(step.filamentId);
        if (f) colors.push(canonicalColor(f.color) ?? normColor(f.color));
      }
    } else {
      for (const e of (job.filamentsUsed ?? []) as any[]) {
        const c = e.color ?? hexToColorName(e.colorHex ?? e.reportedHex);
        if (c) colors.push(canonicalColor(c) ?? normColor(c));
      }
    }
    return [...new Set(colors)];
  }

  /**
   * "Lo que salio de esta impresion": reemplaza las piezas que la impresion
   * habia sumado y guarda los outputs en el job (si despues se corrige el
   * color, recomputeJob las vuelve a calcular). `remember` guarda la placa
   * como plantilla para que el sync la cargue sola la proxima vez.
   */
  async setJobOutputs(
    userId: string,
    jobId: string,
    outputs: JobOutput[],
    opts?: { remember?: boolean; label?: string },
  ) {
    const job: any = await this.prisma.printJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job) throw new NotFoundException('Impresion no encontrada');
    if (!outputs?.length)
      throw new BadRequestException('Decime que piezas salieron');
    await this.assertParts(
      userId,
      outputs.map((o) => o.partId),
    );
    for (const o of outputs) {
      if (!Number.isInteger(o.qty) || o.qty <= 0) {
        throw new BadRequestException(
          'La cantidad tiene que ser un entero > 0',
        );
      }
      if (o.color) o.color = assertColorOrCombo(o.color);
    }
    const moves = await this.movesForJob(userId, job, outputs);

    await this.prisma.printPartMove.deleteMany({
      where: { userId, jobId, reason: 'impresion' },
    });
    await this.prisma.printPartMove.createMany({ data: moves });
    await this.prisma.printJob.update({
      where: { id: jobId },
      data: { partsOutputs: outputs as any },
    });

    if (opts?.remember) {
      if (!job.plateKey) {
        throw new BadRequestException(
          'Esta impresion no trae identificador de placa: se cargo, pero no se puede recordar',
        );
      }
      await this.prisma.printPlateTemplate.upsert({
        where: { userId_matchKey: { userId, matchKey: job.plateKey } },
        create: {
          userId,
          matchKey: job.plateKey,
          label: opts.label ?? job.title,
          outputs: outputs as any,
          weight: job.grams ?? null,
        },
        update: {
          label: opts.label ?? job.title,
          outputs: outputs as any,
          weight: job.grams ?? null,
        },
      });
    }
    return {
      added: moves.map((m) => ({
        partId: m.partId,
        color: m.color,
        qty: m.qty,
      })),
    };
  }

  private async movesForJob(userId: string, job: any, outputs: JobOutput[]) {
    const colors = await this.jobColors(userId, job);
    const moves: any[] = [];
    for (const o of outputs) {
      let targets: string[];
      if (o.combo) targets = [colors.join('+')];
      else if (o.perColorLine) targets = colors;
      else if (o.color) targets = [o.color];
      else if (colors.length === 1) targets = colors;
      else {
        throw new BadRequestException(
          `La impresion tiene ${colors.length} colores (${colors.join(', ')}): decime el color o "por cada color"`,
        );
      }
      if (!targets.length) {
        throw new BadRequestException(
          'No se de que color salio la impresion: pasame el color',
        );
      }
      for (const color of targets) {
        moves.push({
          userId,
          partId: o.partId,
          color,
          qty: o.qty,
          reason: 'impresion',
          jobId: job.id,
        });
      }
    }
    return moves;
  }

  /** Despues de corregir el color de una impresion, sus piezas se recalculan. */
  async recomputeJob(userId: string, jobId: string) {
    const job: any = await this.prisma.printJob.findFirst({
      where: { id: jobId, userId },
    });
    const outputs = (job?.partsOutputs ?? []) as JobOutput[];
    if (!job || !outputs.length) return null;
    const moves = await this.movesForJob(userId, job, outputs);
    await this.prisma.printPartMove.deleteMany({
      where: { userId, jobId, reason: 'impresion' },
    });
    await this.prisma.printPartMove.createMany({ data: moves });
    return moves;
  }

  /** Impresion borrada: sus piezas salen del stock. */
  async removeJob(userId: string, jobId: string) {
    await this.prisma.printPartMove.deleteMany({
      where: { userId, jobId, reason: 'impresion' },
    });
  }

  /**
   * Sync: si la placa tiene plantilla, suma sus piezas sola. No aplica si
   * la placa salio incompleta (objetos salteados) ni si el peso no coincide
   * con el de la plantilla (otro 3MF del mismo diseño con el mismo numero de
   * placa). `multiplier` = repeticiones de la impresion.
   */
  async applyTemplate(
    userId: string,
    jobId: string,
    opts: { multiplier?: number; partial?: boolean } = {},
  ) {
    if (opts.partial) return null;
    const job: any = await this.prisma.printJob.findFirst({
      where: { id: jobId, userId },
    });
    if (!job?.plateKey || job.status === 'fallida') return null;
    const tpl: any = await this.prisma.printPlateTemplate.findUnique({
      where: { userId_matchKey: { userId, matchKey: job.plateKey } },
    });
    if (!tpl) return null;
    if (
      tpl.weight &&
      job.grams &&
      Math.abs(job.grams - tpl.weight) / tpl.weight > 0.03
    ) {
      return null;
    }
    const k = Math.max(1, Math.round(opts.multiplier ?? 1));
    const outputs = (tpl.outputs as JobOutput[]).map((o) => ({
      ...o,
      qty: o.qty * k,
    }));
    return this.setJobOutputs(userId, jobId, outputs);
  }

  // ── Salidas (entrega de pedidos) ──────────────────────────

  /**
   * Al entregar: resta las piezas de cada unidad del pedido (solo de
   * productos con receta). No bloquea la entrega: lo que no alcanza se
   * avisa. Reemplaza una entrega anterior del mismo pedido.
   */
  async consumeForOrder(
    userId: string,
    orderId: string,
    opts: PlanOptions = {},
  ) {
    const order: any = await this.prisma.printOrder.findFirst({
      where: { id: orderId, userId },
      include: { items: { include: { product: true } } },
    });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    await this.revertOrder(userId, orderId);

    const productIds: string[] = [
      ...new Set<string>((order.items ?? []).map((i: any) => i.productId)),
    ];
    const [lines, parts] = await Promise.all([
      this.prisma.printRecipeLine.findMany({
        where: { productId: { in: productIds } },
      }),
      this.prisma.printPart.findMany({ where: { userId } }),
    ]);
    const partNames = Object.fromEntries(parts.map((p: any) => [p.id, p.name]));
    const stock = await this.stock(userId);
    const data: any[] = [];
    const shortfall: string[] = [];
    const consumed: { product: string; units: number }[] = [];
    for (const item of order.items ?? []) {
      const pl = (lines as any[]).filter((l) => l.productId === item.productId);
      if (!pl.length) continue;
      const res = planConsumption(pl as RecipeLine[], stock, item.qty, {
        ...opts,
        partNames,
      });
      for (const m of res.moves) {
        const k = `${m.partId}|${m.color}`;
        stock.set(k, (stock.get(k) ?? 0) - m.qty);
        data.push({
          userId,
          partId: m.partId,
          color: m.color,
          qty: -m.qty,
          reason: 'entrega',
          orderId,
        });
      }
      consumed.push({
        product: item.product?.name ?? item.productId,
        units: res.built,
      });
      shortfall.push(
        ...res.shortfall.map(
          (s) => `${item.product?.name ?? item.productId}: ${s}`,
        ),
      );
    }
    if (data.length) await this.prisma.printPartMove.createMany({ data });
    return { consumed, shortfall };
  }

  /** Des-entregar: las piezas que consumio el pedido vuelven al stock. */
  async revertOrder(userId: string, orderId: string) {
    await this.prisma.printPartMove.deleteMany({
      where: { userId, orderId, reason: 'entrega' },
    });
  }
}
