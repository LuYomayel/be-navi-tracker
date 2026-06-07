import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  Body,
  Query,
  Logger,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { McpAuthService } from './mcp-auth.service';

/** Escapa valores para insertarlos en HTML/atributos de forma segura. */
function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Authorization Server OAuth 2.1 (con PKCE) + discovery metadata para que Claude
 * pueda conectar el connector remoto. Reutiliza el login de NaviTracker como
 * autenticacion del resource owner y emite JWT de la app como access token.
 *
 * Estas rutas viven en la raiz (sin el prefijo global `/api`), ver main.ts.
 *
 * Throttling: la metadata de discovery se deja sin limite (Claude la consulta
 * seguido); los endpoints sensibles (login, token, registro) llevan un limite
 * estricto para evitar fuerza bruta de contraseña / abuso.
 */
@Controller()
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);

  constructor(private readonly auth: McpAuthService) {}

  // ── Discovery metadata ──────────────────────────────────────

  @SkipThrottle()
  @Public()
  @Get('.well-known/oauth-protected-resource')
  protectedResource(@Req() req: Request) {
    const base = this.auth.baseUrl(req);
    return {
      resource: `${base}/mcp`,
      authorization_servers: [base],
    };
  }

  @SkipThrottle()
  @Public()
  @Get('.well-known/oauth-authorization-server')
  authServerMetadata(@Req() req: Request) {
    const base = this.auth.baseUrl(req);
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['navitracker'],
    };
  }

  // ── Dynamic Client Registration (RFC 7591) ──────────────────

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @Post('oauth/register')
  register(@Body() body: any, @Res() res: Response) {
    const client = this.auth.registerClient(body || {});
    res.status(201).json({
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt / 1000),
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      ...(client.clientName ? { client_name: client.clientName } : {}),
    });
  }

  // ── Authorization endpoint ──────────────────────────────────

  @Public()
  @Get('oauth/authorize')
  authorizeForm(@Query() q: any, @Res() res: Response) {
    const error =
      this.validateAuthorizeParams(q) || this.validateRedirectUri(q);
    if (error) {
      res.status(400).send(`Solicitud de autorizacion invalida: ${esc(error)}`);
      return;
    }
    res.status(200).type('html').send(this.renderLogin(q));
  }

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @Post('oauth/authorize')
  async authorizeSubmit(
    @Body() body: any,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const error =
      this.validateAuthorizeParams(body) || this.validateRedirectUri(body);
    if (error) {
      res.status(400).send(`Solicitud de autorizacion invalida: ${esc(error)}`);
      return;
    }

    const user = await this.auth.verifyUserCredentials(
      body.email,
      body.password,
    );
    if (!user) {
      res
        .status(401)
        .type('html')
        .send(
          this.renderLogin(body, 'Credenciales invalidas. Proba de nuevo.'),
        );
      return;
    }

    this.auth.ensureClient(body.client_id, body.redirect_uri);
    const code = this.auth.createAuthCode({
      userId: user.id,
      clientId: body.client_id,
      redirectUri: body.redirect_uri,
      codeChallenge: body.code_challenge,
      codeChallengeMethod: body.code_challenge_method || 'S256',
      scope: body.scope,
      resource: body.resource,
    });

    const redirect = new URL(body.redirect_uri);
    redirect.searchParams.set('code', code);
    if (body.state) redirect.searchParams.set('state', body.state);
    this.logger.log(
      `Autorizacion concedida a usuario ${user.id} (cliente ${body.client_id}).`,
    );
    res.redirect(302, redirect.toString());
  }

  // ── Token endpoint ──────────────────────────────────────────

  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Public()
  @Post('oauth/token')
  async token(@Body() body: any, @Res() res: Response) {
    const grant = body?.grant_type;

    if (grant === 'authorization_code') {
      const record = this.auth.consumeAuthCode(body.code);
      if (!record) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Codigo invalido o expirado',
        });
      }
      if (record.redirectUri !== body.redirect_uri) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'redirect_uri no coincide',
        });
      }
      const pkceOk = this.auth.verifyPkce(
        body.code_verifier,
        record.codeChallenge,
        record.codeChallengeMethod,
      );
      if (!pkceOk) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Verificacion PKCE fallida',
        });
      }
      const tokens = await this.auth.issueTokens(
        record.userId,
        undefined,
        record.scope,
      );
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(tokens);
    }

    if (grant === 'refresh_token') {
      const tokens = await this.auth.refreshTokens(body.refresh_token);
      if (!tokens) {
        return res.status(400).json({
          error: 'invalid_grant',
          error_description: 'Refresh token invalido',
        });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(tokens);
    }

    return res.status(400).json({
      error: 'unsupported_grant_type',
      error_description: `grant_type no soportado: ${grant}`,
    });
  }

  // ── Helpers ─────────────────────────────────────────────────

  private validateAuthorizeParams(p: any): string | null {
    if (!p) return 'sin parametros';
    if (p.response_type !== 'code') return 'response_type debe ser "code"';
    if (!p.client_id) return 'falta client_id';
    if (!p.redirect_uri) return 'falta redirect_uri';
    try {
      // eslint-disable-next-line no-new
      new URL(p.redirect_uri);
    } catch {
      return 'redirect_uri no es una URL valida';
    }
    if (!p.code_challenge) return 'falta code_challenge (PKCE obligatorio)';
    if (p.code_challenge_method && p.code_challenge_method !== 'S256') {
      return 'code_challenge_method debe ser S256';
    }
    return null;
  }

  /**
   * Valida que el redirect_uri pertenezca a la lista registrada del cliente
   * (exact match, OAuth 2.1). Para clientes manuales no registrados se pinea en
   * el primer uso (ver McpAuthService.isRedirectUriRegistered / ensureClient).
   */
  private validateRedirectUri(p: any): string | null {
    if (!this.auth.isRedirectUriRegistered(p.client_id, p.redirect_uri)) {
      return 'redirect_uri no registrado para este cliente';
    }
    return null;
  }

  private renderLogin(p: any, errorMsg?: string): string {
    const hidden = [
      'response_type',
      'client_id',
      'redirect_uri',
      'code_challenge',
      'code_challenge_method',
      'state',
      'scope',
      'resource',
    ]
      .map(
        (k) => `<input type="hidden" name="${k}" value="${esc(p[k] ?? '')}" />`,
      )
      .join('\n      ');

    return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>NaviTracker · Conectar con Claude</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background:#0f172a; color:#e2e8f0; display:flex; min-height:100vh; align-items:center; justify-content:center; margin:0; }
    .card { background:#1e293b; padding:2rem; border-radius:16px; width:100%; max-width:360px; box-shadow:0 10px 40px rgba(0,0,0,.4); }
    h1 { font-size:1.25rem; margin:0 0 .25rem; }
    p.sub { margin:0 0 1.5rem; color:#94a3b8; font-size:.9rem; }
    label { display:block; font-size:.8rem; margin:.75rem 0 .25rem; color:#cbd5e1; }
    input[type=email], input[type=password] { width:100%; box-sizing:border-box; padding:.6rem .75rem; border-radius:8px; border:1px solid #334155; background:#0f172a; color:#e2e8f0; }
    button { width:100%; margin-top:1.5rem; padding:.7rem; border:0; border-radius:8px; background:#6366f1; color:white; font-weight:600; cursor:pointer; }
    button:hover { background:#4f46e5; }
    .error { background:#7f1d1d; color:#fecaca; padding:.5rem .75rem; border-radius:8px; font-size:.85rem; margin-bottom:1rem; }
  </style>
</head>
<body>
  <form class="card" method="post" action="/oauth/authorize">
    <h1>NaviTracker</h1>
    <p class="sub">Inicia sesion para conectar tu cuenta con Claude.</p>
    ${errorMsg ? `<div class="error">${esc(errorMsg)}</div>` : ''}
    <label for="email">Email</label>
    <input id="email" type="email" name="email" required autocomplete="username" />
    <label for="password">Contraseña</label>
    <input id="password" type="password" name="password" required autocomplete="current-password" />
    <button type="submit">Autorizar acceso</button>
    ${hidden}
  </form>
</body>
</html>`;
  }
}
