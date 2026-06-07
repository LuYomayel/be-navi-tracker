import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DeviceTokensService } from './device-tokens.service';

export interface PushPayload {
  title: string;
  body: string;
  /** data extra (ej: { route: "/briefing" }) para rutear al tocar la push. */
  data?: Record<string, string>;
}

/**
 * Envia push notifications via Firebase Cloud Messaging (FCM). FCM entrega
 * tanto a Android como a iOS (con la APNs key cargada en Firebase).
 *
 * Degrada con gracia: si no hay credenciales (FIREBASE_SERVICE_ACCOUNT_BASE64),
 * queda deshabilitado y los envios son no-op (igual que el EmailService sin
 * RESEND_API_KEY). Asi el backend levanta y testea sin Firebase configurado.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private messaging: any = null;
  private enabled = false;

  constructor(private readonly deviceTokens: DeviceTokensService) {}

  async onModuleInit() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!raw) {
      this.logger.warn(
        'Push deshabilitado: falta FIREBASE_SERVICE_ACCOUNT_BASE64.',
      );
      return;
    }

    try {
      const admin = await import('firebase-admin');
      const json = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
      const app = admin.apps?.length
        ? admin.app()
        : admin.initializeApp({ credential: admin.credential.cert(json) });
      this.messaging = admin.messaging(app);
      this.enabled = true;
      this.logger.log('Push (FCM) habilitado.');
    } catch (err) {
      this.logger.error('No se pudo inicializar Firebase Admin (push).', err);
      this.enabled = false;
    }
  }

  isEnabled() {
    return this.enabled;
  }

  /** Envia una push a todos los dispositivos del usuario. */
  async sendToUser(userId: string, payload: PushPayload): Promise<number> {
    if (!this.enabled || !this.messaging) return 0;

    const tokens = await this.deviceTokens.getTokensForUser(userId);
    if (!tokens.length) return 0;

    try {
      const res = await this.messaging.sendEachForMulticast({
        tokens,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
      });

      // Limpiar tokens que FCM reporta como invalidos.
      const invalid: string[] = [];
      res.responses.forEach((r: any, i: number) => {
        const code = r.error?.code;
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token'
        ) {
          invalid.push(tokens[i]);
        }
      });
      if (invalid.length) await this.deviceTokens.pruneTokens(invalid);

      return res.successCount ?? 0;
    } catch (err) {
      this.logger.error('Error enviando push.', err);
      return 0;
    }
  }
}
