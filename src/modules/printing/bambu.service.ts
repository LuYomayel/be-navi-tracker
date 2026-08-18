import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { StockService } from './stock.service';
import { toLocalDateString } from '../../common/utils/date.utils';

const HOSTS: Record<string, string> = {
  global: 'https://api.bambulab.com',
  china: 'https://api.bambulab.cn',
};

interface BambuTask {
  id: number;
  title?: string;
  deviceId?: string;
  status?: number;
  startTime?: string; // ISO
  endTime?: string;
  weight?: number; // gramos totales
  costTime?: number; // segundos
  amsDetailMapping?: {
    ams?: number;
    targetColor?: string; // hex RGBA, ej "00AE42FF"
    filamentType?: string;
    weight?: number; // gramos de ese filamento
  }[];
}

/**
 * Integracion con Bambu Cloud por POLLING de la API de tasks (no MQTT):
 * cada impresion terminada aparece en /v1/user-service/my/tasks con el peso
 * total y el desglose por filamento/color (amsDetailMapping) — exactamente
 * lo que necesita el stock. Mas robusto que sostener una conexion MQTT
 * desde el droplet, y sobrevive a los cambios de firmware de LAN.
 *
 * El token se saca de la sesion de MakerWorld (cookie `token`) y se guarda
 * encriptado AES-256-GCM (mismo esquema que Google Calendar).
 */
@Injectable()
export class BambuService {
  private readonly logger = new Logger(BambuService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockService,
  ) {}

  // ── Conexion ──────────────────────────────────────────────

  async connect(
    userId: string,
    dto: { token: string; region?: 'global' | 'china' },
  ) {
    const token = dto.token?.trim();
    if (!token) throw new BadRequestException('Falta el token de Bambu');
    const region = dto.region === 'china' ? 'china' : 'global';

    // Verificar contra la API antes de guardar (1 request barato).
    await this.fetchTasks(token, region, 1);

    await this.prisma.printSettings.update({
      where: { userId },
      data: {
        bambuToken: this.encrypt(token),
        bambuRegion: region,
        // Desde aca en adelante: lo impreso ANTES de conectar no descuenta
        // stock (se puede importar como historial, sin aplicar).
        bambuLastSyncAt: new Date(),
      },
    });
    return { connected: true, region };
  }

  async disconnect(userId: string) {
    await this.prisma.printSettings.update({
      where: { userId },
      data: { bambuToken: null },
    });
    return { connected: false };
  }

  async getStatus(userId: string) {
    const settings = await this.prisma.printSettings.findUnique({
      where: { userId },
    });
    return {
      connected: !!settings?.bambuToken,
      region: settings?.bambuRegion ?? 'global',
      lastSyncAt: settings?.bambuLastSyncAt ?? null,
    };
  }

  // ── Sync ──────────────────────────────────────────────────

  /**
   * Trae las ultimas impresiones de Bambu Cloud y las registra como
   * PrintJobs (descontando stock las nuevas). `importHistory` ademas
   * importa las anteriores a la conexion SIN descontar (solo registro).
   */
  async sync(userId: string, opts?: { importHistory?: boolean }) {
    const settings = await this.prisma.printSettings.findUnique({
      where: { userId },
    });
    if (!settings?.bambuToken) {
      throw new BadRequestException('Bambu no esta conectado');
    }
    const token = this.decrypt(settings.bambuToken);
    const region = settings.bambuRegion ?? 'global';
    const since = settings.bambuLastSyncAt
      ? new Date(settings.bambuLastSyncAt)
      : new Date(0);

    const { hits } = await this.fetchTasks(token, region, 40);
    const existing = new Set(
      (
        await this.prisma.printJob.findMany({
          where: { userId, source: 'bambu' },
          select: { externalId: true },
        })
      ).map((j: any) => j.externalId),
    );

    let created = 0;
    let skipped = 0;
    let unmatchedGrams = 0;
    const results: any[] = [];

    for (const task of hits ?? []) {
      const externalId = `bambu:${task.id}`;
      if (existing.has(externalId)) {
        skipped++;
        continue;
      }
      const startedAt = task.startTime ? new Date(task.startTime) : null;
      const isNew = !!startedAt && startedAt > since;
      if (!isNew && !opts?.importHistory) {
        skipped++;
        continue;
      }

      const entries = (task.amsDetailMapping ?? [])
        .filter((m) => Number.isFinite(m.weight) && m.weight! > 0)
        .map((m) => ({
          color: undefined,
          colorHex: m.targetColor,
          grams: m.weight!,
        }));

      const endAt = task.endTime
        ? new Date(task.endTime)
        : startedAt && task.costTime
          ? new Date(startedAt.getTime() + task.costTime * 1000)
          : (startedAt ?? new Date());

      const res = await this.stock.createJob(userId, {
        title: task.title || `Impresion ${task.id}`,
        date: toLocalDateString(endAt),
        grams: task.weight ?? undefined,
        hours: task.costTime
          ? Math.round((task.costTime / 3600) * 100) / 100
          : undefined,
        filamentsUsed: entries,
        apply: isNew ? undefined : false,
        source: 'bambu',
        externalId,
        notes: task.deviceId ? `Impresora ${task.deviceId}` : undefined,
      });
      created++;
      unmatchedGrams += res.unmatchedGrams ?? 0;
      results.push({
        title: task.title,
        grams: task.weight,
        applied: res.applied,
        unmatchedGrams: res.unmatchedGrams,
      });
    }

    await this.prisma.printSettings.update({
      where: { userId },
      data: { bambuLastSyncAt: new Date() },
    });

    return { created, skipped, unmatchedGrams, results };
  }

  /** Cron cada 30 min: sync de todos los usuarios con Bambu conectado. */
  @Cron('*/30 * * * *', { timeZone: 'America/Argentina/Buenos_Aires' })
  async syncCron() {
    const connected = await this.prisma.printSettings.findMany({
      where: { bambuToken: { not: null } },
      select: { userId: true },
    });
    for (const { userId } of connected) {
      try {
        const res = await this.sync(userId);
        if (res.created) {
          this.logger.log(
            `Bambu sync ${userId}: ${res.created} impresiones nuevas`,
          );
        }
      } catch (error) {
        this.logger.warn(`Bambu sync fallo para ${userId}: ${error}`);
      }
    }
  }

  // ── API Bambu ─────────────────────────────────────────────

  private async fetchTasks(
    token: string,
    region: string,
    limit: number,
  ): Promise<{ total: number; hits: BambuTask[] }> {
    const host = HOSTS[region] ?? HOSTS.global;
    let res: any;
    try {
      res = await fetch(`${host}/v1/user-service/my/tasks?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      throw new BadRequestException('No se pudo conectar con Bambu Cloud');
    }
    if (!res.ok) {
      throw new BadRequestException(
        res.status === 401
          ? 'Bambu rechazo el token (vencido o invalido): reconecta con uno nuevo'
          : `Bambu Cloud respondio ${res.status}`,
      );
    }
    return res.json();
  }

  // ── Crypto (mismo esquema AES-256-GCM que Google Calendar) ─

  private getEncryptionKey(): Buffer {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) {
      const secret = process.env.JWT_SECRET || 'navitracker-default-key';
      return crypto.scryptSync(secret, 'salt', 32);
    }
    if (key.length === 64) return Buffer.from(key, 'hex');
    return crypto.scryptSync(key, 'salt', 32);
  }

  private encrypt(text: string): string {
    const key = this.getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    const key = this.getEncryptionKey();
    const [ivHex, authTagHex, encrypted] = encryptedText.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}
