import { Injectable, Logger } from '@nestjs/common';

/**
 * Envio de mails via Resend (https://resend.com) usando su HTTP API directa
 * (sin dependencia extra). Si no hay `RESEND_API_KEY` configurada, NO falla:
 * loguea un warning y devuelve false, para que el briefing igual se persista.
 *
 * Env vars:
 *  - RESEND_API_KEY  (requerida para enviar)
 *  - RESEND_FROM     remitente; default 'NaviTracker <onboarding@resend.dev>'
 *                    (onboarding@resend.dev solo permite enviarte a vos mismo;
 *                    para enviar a cualquier destino, verificar un dominio en
 *                    Resend y usar p.ej. 'NaviTracker <briefing@tu-dominio>').
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  get isConfigured(): boolean {
    return !!process.env.RESEND_API_KEY;
  }

  async send(params: {
    to: string;
    subject: string;
    html: string;
    text?: string;
  }): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        'RESEND_API_KEY no configurada; se omite el envio del mail.',
      );
      return false;
    }
    const from =
      process.env.RESEND_FROM || 'NaviTracker <onboarding@resend.dev>';
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: params.to,
          subject: params.subject,
          html: params.html,
          ...(params.text ? { text: params.text } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`Resend respondio ${res.status}: ${body}`);
        return false;
      }
      this.logger.log(`Mail enviado a ${params.to}: "${params.subject}"`);
      return true;
    } catch (err) {
      this.logger.error(`Error enviando mail: ${(err as Error).message}`);
      return false;
    }
  }
}
