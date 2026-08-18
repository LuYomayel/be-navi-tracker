import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { GoalService } from '../goal/goal.service';
import { getLocalDateString } from '../../common/utils/date.utils';

export interface AddSettlementDto {
  amount?: number; // ARS cobrados; sin esto se liquida todo lo restante
  qty?: number; // unidades cobradas (alternativa: amount = qty * chargedUnit)
  date?: string; // YYYY-MM-DD, default hoy
  notes?: string;
}

type SaleWithSettlements = {
  id: string;
  userId: string;
  qty: number;
  chargedUnit: number;
  costUnit: number;
  kind: string;
  status: string;
  incomeId: string | null;
  settlements: { amount: number }[];
  product?: { name: string } | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
// Tolerancia de centavos para no dejar ventas "parciales" por redondeo.
const EPS = 0.01;

/**
 * Liquidaciones (pagos) de ventas 3D. Una venta puede cobrarse en varios
 * pagos parciales (Marcelito pago 3 de 5): cada pago crea su Income con el
 * costo prorrateado, y el estado de la venta se deriva de lo cobrado.
 *
 * Compat legacy: las ventas liquidadas antes de este modulo tienen
 * incomeId directo y cero settlements — se tratan como 100% cobradas.
 */
@Injectable()
export class SettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly goalService: GoalService,
  ) {}

  /** Total, cobrado y restante de una venta (contempla el legacy). */
  settledInfo(sale: SaleWithSettlements): {
    total: number;
    settledAmount: number;
    remaining: number;
  } {
    const total = round2(sale.qty * sale.chargedUnit);
    const fromSettlements = (sale.settlements ?? []).reduce(
      (a, s) => a + s.amount,
      0,
    );
    const legacySettled =
      sale.status === 'liquidado' &&
      (sale.settlements ?? []).length === 0 &&
      !!sale.incomeId;
    const settledAmount = round2(legacySettled ? total : fromSettlements);
    return {
      total,
      settledAmount,
      remaining: round2(Math.max(0, total - settledAmount)),
    };
  }

  async list(userId: string, saleId: string) {
    return this.prisma.printSaleSettlement.findMany({
      where: { userId, saleId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Registra un pago (total o parcial) y crea el Income correspondiente. */
  async add(userId: string, saleId: string, dto: AddSettlementDto) {
    const sale = (await this.prisma.printSale.findFirst({
      where: { id: saleId, userId },
      include: { settlements: true, product: true },
    })) as SaleWithSettlements | null;
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (sale.kind === 'muestra') {
      throw new BadRequestException('Las muestras no se liquidan (se regalan)');
    }

    const { total, settledAmount, remaining } = this.settledInfo(sale);
    if (total <= 0) {
      throw new BadRequestException('La venta no tiene monto a cobrar');
    }
    if (remaining <= 0) {
      throw new BadRequestException('La venta ya esta liquidada');
    }

    if (dto.qty !== undefined && dto.qty <= 0) {
      throw new BadRequestException('La cantidad debe ser mayor a 0');
    }
    const amount = round2(
      dto.amount ?? (dto.qty !== undefined ? dto.qty * sale.chargedUnit : remaining),
    );
    if (amount <= 0) {
      throw new BadRequestException('El monto debe ser mayor a 0');
    }
    if (amount > remaining + EPS) {
      throw new BadRequestException(
        `El monto excede lo que falta cobrar ($${remaining})`,
      );
    }

    const date = dto.date || getLocalDateString();
    const totalCost = sale.qty * sale.costUnit;
    const proratedCost = round2((amount / total) * totalCost);
    const activeGoal = await this.goalService.getActive(userId);

    const newSettled = round2(settledAmount + amount);
    const fullySettled = newSettled >= total - EPS;

    const income = await this.prisma.income.create({
      data: {
        userId,
        date,
        description: `Venta 3D: pago ${fullySettled ? 'final' : 'parcial'} ${sale.qty}x ${sale.product?.name ?? 'producto'}`,
        amount,
        cost: proratedCost,
        source: '3d',
        status: 'received',
        goalId: activeGoal?.id ?? null,
      },
    });

    const settlement = await this.prisma.printSaleSettlement.create({
      data: {
        userId,
        saleId: sale.id,
        date,
        amount,
        qty: dto.qty ?? null,
        incomeId: income.id,
        notes: dto.notes || null,
      },
    });

    const updatedSale = await this.prisma.printSale.update({
      where: { id: sale.id },
      data: { status: fullySettled ? 'liquidado' : 'parcial' },
    });

    return { settlement, sale: updatedSale, income };
  }

  /** Borra un pago (con su Income) y recomputa el estado de la venta. */
  async remove(userId: string, settlementId: string) {
    const settlement = await this.prisma.printSaleSettlement.findFirst({
      where: { id: settlementId, userId },
    });
    if (!settlement) throw new NotFoundException('Pago no encontrado');

    if (settlement.incomeId) {
      await this.prisma.income
        .delete({ where: { id: settlement.incomeId } })
        .catch(() => null);
    }
    await this.prisma.printSaleSettlement.delete({
      where: { id: settlementId },
    });

    const sale = (await this.prisma.printSale.findFirst({
      where: { id: settlement.saleId, userId },
      include: { settlements: true },
    })) as SaleWithSettlements | null;
    if (sale) {
      const stillSettled = (sale.settlements ?? [])
        .filter((s: any) => s.id !== settlementId)
        .reduce((a, s) => a + s.amount, 0);
      const total = sale.qty * sale.chargedUnit;
      const status =
        stillSettled <= 0
          ? 'a_liquidar'
          : stillSettled >= total - EPS
            ? 'liquidado'
            : 'parcial';
      await this.prisma.printSale.update({
        where: { id: sale.id },
        data: { status },
      });
    }
    return true;
  }
}
