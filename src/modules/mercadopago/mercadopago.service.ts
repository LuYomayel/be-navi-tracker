import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../config/prisma.service';
import { ExpenseCategorizerService } from '../expenses/expense-categorizer.service';
import {
  getLocalDateString,
  toLocalDateString,
} from '../../common/utils/date.utils';

/**
 * Sync de gastos desde el reporte "Todas las transacciones" de Mercado Pago.
 *
 * Flujo: crear reporte por API → esperar generación → descargar CSV →
 * clasificar filas → crear gastos (source 'mercadopago') con dedup doble:
 * por id de transacción de MP (externalId) y heurística contra cargas manuales.
 *
 * Requiere MP_ACCESS_TOKEN (credencial de producción de la cuenta REAL) en el
 * .env. Sin token el módulo queda deshabilitado (el cron no hace nada).
 */

const MP_API = 'https://api.mercadopago.com/v1/account/settlement_report';

export type MpRow = Record<string, string>;

export interface MpMovement {
  kind: 'gasto' | 'ingreso' | 'skip';
  reason?: string;
  date: string; // YYYY-MM-DD (ART)
  amount: number; // siempre positivo
  description: string;
  sourceId: string;
}

export interface MpSyncSummary {
  from: string;
  to: string;
  dryRun: boolean;
  imported: number;
  skipped: number;
  ingresosDetectados: { date: string; amount: number; description: string }[];
  detalles: {
    accion: 'importado' | 'salteado';
    motivo?: string;
    date: string;
    amount: number;
    description: string;
  }[];
}

/** Parsea el CSV del reporte (separador ';', primera fila = headers). */
export function parseSettlementCsv(csv: string): MpRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(';').map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(';');
    const row: MpRow = {};
    headers.forEach((h, i) => {
      row[h] = (values[i] ?? '').trim();
    });
    return row;
  });
}

function parseAmount(raw: string | undefined): number {
  if (!raw) return 0;
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

// Retiros a cuenta bancaria propia: no son gastos, es mover tu propia plata
const SELF_TYPES = new Set(['WITHDRAWAL', 'WITHDRAWAL_CANCEL']);

// Transferencias a cuentas bancarias (CBU): el reporte NO trae la contraparte,
// así que no se puede distinguir "me mandé plata a mi banco" de "le pagué a
// alguien por CBU". Verificado 2026-08-06 con datos reales: el dry-run habría
// importado $1.16M de transferencias propias. Se saltean y se reportan para
// carga manual de las que sí sean gastos.
const BANK_TRANSFER_TYPES = new Set(['PAYOUT', 'PAYOUTS']);

/** Clasifica una fila del reporte en gasto / ingreso / skip (con motivo). */
export function classifyRow(row: MpRow): MpMovement {
  const net = parseAmount(row.SETTLEMENT_NET_AMOUNT) || parseAmount(row.TRANSACTION_AMOUNT);
  const date = row.TRANSACTION_DATE
    ? toLocalDateString(new Date(row.TRANSACTION_DATE))
    : getLocalDateString();
  const description =
    [row.DESCRIPTION, row.TRANSACTION_TYPE, row.PAYMENT_METHOD]
      .filter(Boolean)
      .slice(0, 1)
      .join('') || 'Movimiento MP';
  const base = {
    date,
    amount: Math.abs(net),
    description: `${description} (MP)`,
    sourceId: row.SOURCE_ID || '',
  };

  if (SELF_TYPES.has(row.TRANSACTION_TYPE)) {
    return {
      ...base,
      kind: 'skip',
      reason: 'retiro/transferencia a cuenta propia',
    };
  }
  if (BANK_TRANSFER_TYPES.has(row.TRANSACTION_TYPE) && net < 0) {
    return {
      ...base,
      kind: 'skip',
      reason:
        'transferencia a cuenta bancaria (CBU) — puede ser tuya; si es un gasto real cargalo a mano',
    };
  }
  if (net < 0) return { ...base, kind: 'gasto' };
  if (net > 0) return { ...base, kind: 'ingreso' };
  return { ...base, kind: 'skip', reason: 'monto cero' };
}

@Injectable()
export class MercadoPagoService {
  private readonly logger = new Logger(MercadoPagoService.name);

  constructor(
    private prisma: PrismaService,
    private categorizer: ExpenseCategorizerService,
  ) {}

  isEnabled(): boolean {
    return !!process.env.MP_ACCESS_TOKEN;
  }

  private headers() {
    return {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      'content-type': 'application/json',
      accept: 'application/json',
    };
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Día ART (YYYY-MM-DD) → instante UTC en que arranca ese día (ART = UTC-3). */
  private artDayToUtc(day: string): string {
    return `${day}T03:00:00Z`;
  }

  /**
   * Sync de un rango de días ART [from, to): crea el reporte en MP, espera la
   * generación, descarga el CSV e importa los gastos nuevos.
   */
  async sync(opts: {
    from?: string;
    to?: string;
    dryRun?: boolean;
    pollIntervalMs?: number;
    maxPolls?: number;
  }): Promise<MpSyncSummary> {
    if (!this.isEnabled()) {
      throw new BadRequestException(
        'Falta MP_ACCESS_TOKEN en el .env — el sync de Mercado Pago está deshabilitado',
      );
    }
    const user = await this.resolveUser();
    const to = opts.to || getLocalDateString();
    const from = opts.from || to;
    const dryRun = !!opts.dryRun;
    const pollIntervalMs = opts.pollIntervalMs ?? 10_000;
    const maxPolls = opts.maxPolls ?? 30;

    const summary: MpSyncSummary = {
      from,
      to,
      dryRun,
      imported: 0,
      skipped: 0,
      ingresosDetectados: [],
      detalles: [],
    };

    try {
      const csv = await this.fetchReportCsv(from, to, pollIntervalMs, maxPolls);
      const movements = parseSettlementCsv(csv).map(classifyRow);

      for (const m of movements) {
        if (m.kind === 'skip') {
          summary.skipped++;
          summary.detalles.push({
            accion: 'salteado',
            motivo: m.reason,
            date: m.date,
            amount: m.amount,
            description: m.description,
          });
          continue;
        }
        if (m.kind === 'ingreso') {
          summary.ingresosDetectados.push({
            date: m.date,
            amount: m.amount,
            description: m.description,
          });
          continue;
        }

        const externalId = `mp:${m.sourceId}`;
        const already = await this.prisma.expense.findFirst({
          where: { userId: user.id, externalId },
        });
        if (already) {
          summary.skipped++;
          summary.detalles.push({
            accion: 'salteado',
            motivo: 'ya importado (externalId)',
            date: m.date,
            amount: m.amount,
            description: m.description,
          });
          continue;
        }

        // Heurística anti-duplicado con cargas manuales: mismo día + monto
        const manualDup = await this.prisma.expense.findFirst({
          where: {
            userId: user.id,
            date: m.date,
            amount: m.amount,
            externalId: null,
          },
        });
        if (manualDup) {
          summary.skipped++;
          summary.detalles.push({
            accion: 'salteado',
            motivo: `posible duplicado manual ("${manualDup.description}")`,
            date: m.date,
            amount: m.amount,
            description: m.description,
          });
          continue;
        }

        // Categorización completa: reglas → historial → IA con umbral
        const sug = await this.categorizer
          .categorize(user.id, m.description)
          .catch(() => null);

        if (!dryRun) {
          await this.prisma.expense.create({
            data: {
              userId: user.id,
              date: m.date,
              amount: m.amount,
              description: m.description,
              categoryId: sug?.categoryId || null,
              source: 'mercadopago',
              externalId,
            },
          });
        }
        summary.imported++;
        summary.detalles.push({
          accion: 'importado',
          date: m.date,
          amount: m.amount,
          description: m.description,
        });
      }

      await this.logRun(user.id, summary, null);
      return summary;
    } catch (error) {
      await this.logRun(user.id, summary, (error as Error).message).catch(
        () => undefined,
      );
      throw error;
    }
  }

  /**
   * Si la cuenta no tiene configuración de reportes (404), crea una con las
   * columnas que enriquecen el import (neto, descripción, pagador). Si ya
   * existe una config, NO se toca.
   */
  private async ensureConfig(): Promise<void> {
    const res = await fetch(`${MP_API}/config`, { headers: this.headers() });
    if (res.status !== 404) return;
    const columns = [
      'EXTERNAL_REFERENCE',
      'SOURCE_ID',
      'PAYMENT_METHOD_TYPE',
      'PAYMENT_METHOD',
      'TRANSACTION_TYPE',
      'TRANSACTION_AMOUNT',
      'TRANSACTION_CURRENCY',
      'TRANSACTION_DATE',
      'FEE_AMOUNT',
      'SETTLEMENT_NET_AMOUNT',
      'SETTLEMENT_DATE',
      'REAL_AMOUNT',
      'DESCRIPTION',
      'PAYER_NAME',
      'INSTALLMENTS',
    ].map((key) => ({ key }));
    const create = await fetch(`${MP_API}/config`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        file_name_prefix: 'navitracker',
        include_withdraw: true,
        // frequency es REQUERIDO por la API aunque no se active el schedule
        // (verificado 2026-08-06: sin config creada, crear reportes da 404)
        frequency: { hour: 6, type: 'daily', value: 0 },
        columns,
      }),
    });
    if (!create.ok) {
      this.logger.warn(
        `No se pudo crear la config de reportes MP (${create.status}) — sigo con las columnas default`,
      );
    }
  }

  /** Crea el reporte en MP y espera a que esté generado; devuelve el CSV. */
  private async fetchReportCsv(
    from: string,
    to: string,
    pollIntervalMs: number,
    maxPolls: number,
  ): Promise<string> {
    await this.ensureConfig();
    const createRes = await fetch(MP_API, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        begin_date: this.artDayToUtc(from),
        end_date: this.artDayToUtc(to),
      }),
    });
    if (createRes.status === 203) {
      throw new BadRequestException(
        'MP no pudo crear el reporte (203): reintentá en unos minutos',
      );
    }
    if (!createRes.ok) {
      throw new BadRequestException(
        `MP devolvió ${createRes.status} al crear el reporte: ${await createRes
          .text?.()
          .catch(() => '')}`,
      );
    }
    const created = (await createRes.json()) as { id: number };

    for (let i = 0; i < maxPolls; i++) {
      const listRes = await fetch(`${MP_API}/list`, {
        headers: this.headers(),
      });
      if (listRes.ok) {
        const list = (await listRes.json()) as {
          id: number;
          file_name?: string;
        }[];
        const entry = list.find((r) => r.id === created.id && r.file_name);
        if (entry?.file_name) {
          const fileRes = await fetch(`${MP_API}/${entry.file_name}`, {
            headers: this.headers(),
          });
          if (!fileRes.ok) {
            throw new BadRequestException(
              `MP devolvió ${fileRes.status} al descargar ${entry.file_name}`,
            );
          }
          return fileRes.text();
        }
      }
      await this.sleep(pollIntervalMs);
    }
    throw new BadRequestException(
      `Timeout esperando la generación del reporte de MP (${maxPolls} intentos)`,
    );
  }

  private async resolveUser(): Promise<{ id: string }> {
    const email = process.env.MP_SYNC_USER_EMAIL;
    const user = await this.prisma.user.findFirst({
      where: email ? { email } : undefined,
      orderBy: { createdAt: 'asc' },
    });
    if (!user) {
      throw new BadRequestException(
        email
          ? `No existe el usuario ${email} (MP_SYNC_USER_EMAIL)`
          : 'No hay usuarios en la base',
      );
    }
    return user;
  }

  private async logRun(
    userId: string,
    summary: MpSyncSummary,
    error: string | null,
  ) {
    await this.prisma.mpSyncLog.create({
      data: {
        userId,
        fromDate: summary.from,
        toDate: summary.to,
        dryRun: summary.dryRun,
        imported: summary.imported,
        skipped: summary.skipped,
        error,
        details: {
          ingresosDetectados: summary.ingresosDetectados,
          detalles: summary.detalles.slice(0, 100),
        } as any,
      },
    });
  }

  async getStatus(userId: string) {
    const logs = await this.prisma.mpSyncLog.findMany({
      where: { userId },
      orderBy: { runAt: 'desc' },
      take: 10,
    });
    return { enabled: this.isEnabled(), lastRuns: logs };
  }

  /** Cron diario 07:20 ART: importa los gastos de ayer. */
  @Cron('20 7 * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async dailySyncCron() {
    if (!this.isEnabled()) return;
    try {
      const today = getLocalDateString();
      const [y, m, d] = today.split('-').map(Number);
      const yest = new Date(y, m - 1, d - 1);
      const yesterday = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`;
      const s = await this.sync({ from: yesterday, to: today });
      this.logger.log(
        `MP sync diario (${yesterday}): ${s.imported} gastos importados, ${s.skipped} salteados`,
      );
    } catch (error) {
      this.logger.error('Error en el sync diario de Mercado Pago:', error);
    }
  }
}
