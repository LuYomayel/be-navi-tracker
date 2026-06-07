import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'crypto';
import { AuthService } from '../auth/auth.service';

/**
 * Configuracion del servidor MCP leida desde variables de entorno.
 *
 *  - MCP_AUTH_MODE     'oauth' (default) | 'none'  → en modo 'none' el endpoint
 *                      /mcp queda "authless" para desarrollo/Inspector local.
 *  - MCP_STATIC_TOKEN  token Bearer fijo (opcional) para pruebas rapidas; cuando
 *                      se presenta se resuelve al usuario MCP_STATIC_USER_ID.
 *  - MCP_STATIC_USER_ID usuario asociado al token estatico / modo authless.
 *  - MCP_BASE_URL      URL publica del servidor (para la metadata OAuth). Si no
 *                      se define se infiere de los headers de la request.
 *  - MCP_ACCESS_TTL    segundos de vida del access token (default 3600).
 *  - MCP_REFRESH_TTL   segundos de vida del refresh token (default 30 dias).
 */
export interface McpAuthContext {
  userId: string;
  email?: string;
  name?: string;
  scope?: string;
}

interface OAuthClient {
  clientId: string;
  clientSecret?: string;
  redirectUris: string[];
  clientName?: string;
  createdAt: number;
}

interface AuthCodeRecord {
  code: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope?: string;
  resource?: string;
  expiresAt: number;
}

@Injectable()
export class McpAuthService {
  private readonly logger = new Logger(McpAuthService.name);

  /**
   * Almacenes en memoria para clientes DCR y codigos de autorizacion.
   *
   * NOTA: al ser en memoria se pierden si el proceso se reinicia. Para una sola
   * instancia es suficiente (Claude vuelve a registrarse / re-autoriza si hace
   * falta). Si se escala a varias instancias o se quiere persistencia, mover
   * estos mapas a la base (modelos Prisma OAuthClient / OAuthCode).
   */
  private readonly clients = new Map<string, OAuthClient>();
  private readonly authCodes = new Map<string, AuthCodeRecord>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  // ────────────────────────────────────────────────────────────
  //  Configuracion
  // ────────────────────────────────────────────────────────────

  /**
   * Secreto JWT requerido. En produccion NO hay fallback: si falta la env var
   * lanza (fail-fast) para no firmar/validar tokens con un secreto conocido.
   * Fuera de produccion usa un fallback explicito SOLO para dev/test.
   */
  private secret(name: 'JWT_SECRET' | 'JWT_REFRESH_SECRET'): string {
    const value = process.env[name];
    if (value) return value;
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `Falta la variable de entorno ${name} (requerida en produccion)`,
      );
    }
    return name === 'JWT_SECRET'
      ? 'dev-only-insecure-jwt-secret'
      : 'dev-only-insecure-jwt-refresh-secret';
  }

  /**
   * Solo en dev/test (o con MCP_ALLOW_INSECURE=true) se habilitan los atajos
   * inseguros: modo authless y token estatico. En produccion nunca.
   */
  private get insecureAllowed(): boolean {
    return (
      process.env.NODE_ENV !== 'production' ||
      process.env.MCP_ALLOW_INSECURE === 'true'
    );
  }

  get authMode(): 'oauth' | 'none' {
    return process.env.MCP_AUTH_MODE === 'none' && this.insecureAllowed
      ? 'none'
      : 'oauth';
  }

  private get accessTtl(): number {
    return parseInt(process.env.MCP_ACCESS_TTL || '3600', 10);
  }

  private get refreshTtl(): number {
    return parseInt(process.env.MCP_REFRESH_TTL || `${60 * 60 * 24 * 30}`, 10);
  }

  /** URL publica base del servidor (sin barra final). */
  baseUrl(req: any): string {
    if (process.env.MCP_BASE_URL) {
      return process.env.MCP_BASE_URL.replace(/\/$/, '');
    }
    const proto =
      (req.headers['x-forwarded-proto'] as string)?.split(',')[0] ||
      req.protocol ||
      'https';
    const host =
      (req.headers['x-forwarded-host'] as string) ||
      (req.headers['host'] as string);
    return `${proto}://${host}`.replace(/\/$/, '');
  }

  // ────────────────────────────────────────────────────────────
  //  Validacion del Bearer token en /mcp
  // ────────────────────────────────────────────────────────────

  async resolveBearer(
    token: string | undefined,
  ): Promise<McpAuthContext | null> {
    // Modo authless: cualquier request es valida y se mapea a un usuario fijo.
    if (this.authMode === 'none') {
      const userId = process.env.MCP_STATIC_USER_ID;
      if (!userId) {
        this.logger.warn(
          'MCP_AUTH_MODE=none pero falta MCP_STATIC_USER_ID; no se puede resolver el usuario.',
        );
        return null;
      }
      return { userId };
    }

    if (!token) return null;

    // Token estatico opcional para pruebas (nunca en produccion).
    if (
      this.insecureAllowed &&
      process.env.MCP_STATIC_TOKEN &&
      token === process.env.MCP_STATIC_TOKEN &&
      process.env.MCP_STATIC_USER_ID
    ) {
      return { userId: process.env.MCP_STATIC_USER_ID };
    }

    // Token OAuth = JWT firmado por NaviTracker.
    try {
      const payload: any = await this.jwtService.verifyAsync(token, {
        secret: this.secret('JWT_SECRET'),
      });
      if (payload?.typ === 'refresh') return null; // un refresh no sirve como access
      const user = await this.authService.validateUserById(payload.sub);
      if (!user || !user.isActive) return null;
      return {
        userId: user.id,
        email: user.email,
        name: user.name,
        scope: payload.scope,
      };
    } catch (err) {
      this.logger.debug(`Bearer invalido: ${(err as Error).message}`);
      return null;
    }
  }

  // ────────────────────────────────────────────────────────────
  //  Dynamic Client Registration (RFC 7591)
  // ────────────────────────────────────────────────────────────

  registerClient(metadata: any): OAuthClient {
    const redirectUris: string[] = Array.isArray(metadata?.redirect_uris)
      ? metadata.redirect_uris
      : [];
    const client: OAuthClient = {
      clientId: `mcp_${randomBytes(16).toString('hex')}`,
      // Clientes publicos (Claude usa PKCE) → sin secret.
      clientSecret: undefined,
      redirectUris,
      clientName: metadata?.client_name,
      createdAt: Date.now(),
    };
    this.clients.set(client.clientId, client);
    this.logger.log(
      `Cliente OAuth registrado (DCR): ${client.clientId} (${client.clientName || 'sin nombre'})`,
    );
    return client;
  }

  getClient(clientId: string): OAuthClient | undefined {
    return this.clients.get(clientId);
  }

  /**
   * Garantiza que exista un cliente para `clientId`. Si Claude usa un client_id
   * manual (cargado en "Advanced settings") que todavia no esta registrado, lo
   * aceptamos de forma perezosa para no romper el flujo.
   */
  ensureClient(clientId: string, redirectUri?: string): OAuthClient {
    let client = this.clients.get(clientId);
    if (!client) {
      // Cliente manual (no registrado via DCR): se pinea su redirect_uri en el
      // primer uso. NO se amplian las URIs de un cliente ya existente (evita
      // open-redirect del authorization code).
      client = {
        clientId,
        redirectUris: redirectUri ? [redirectUri] : [],
        createdAt: Date.now(),
      };
      this.clients.set(clientId, client);
    }
    return client;
  }

  /**
   * Valida un redirect_uri contra los registrados del cliente (exact match,
   * OAuth 2.1). Para un cliente desconocido o sin URIs registradas (cliente
   * manual) devuelve true: se pinea en el primer uso via ensureClient.
   */
  isRedirectUriRegistered(clientId: string, redirectUri: string): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.redirectUris.length === 0) return true;
    return client.redirectUris.includes(redirectUri);
  }

  // ────────────────────────────────────────────────────────────
  //  Authorization Code + PKCE
  // ────────────────────────────────────────────────────────────

  /** Verifica credenciales del usuario (resource owner) via AuthService. */
  async verifyUserCredentials(
    email: string,
    password: string,
  ): Promise<{ id: string; email: string; name: string } | null> {
    try {
      const res = await this.authService.login({ email, password });
      return {
        id: res.user.id as string,
        email: res.user.email as string,
        name: res.user.name as string,
      };
    } catch {
      return null;
    }
  }

  createAuthCode(params: Omit<AuthCodeRecord, 'code' | 'expiresAt'>): string {
    const code = randomBytes(32).toString('hex');
    this.authCodes.set(code, {
      ...params,
      code,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutos
    });
    return code;
  }

  consumeAuthCode(code: string): AuthCodeRecord | null {
    const record = this.authCodes.get(code);
    if (!record) return null;
    this.authCodes.delete(code); // un solo uso
    if (record.expiresAt < Date.now()) return null;
    return record;
  }

  /** Verifica PKCE (solo S256, segun exige OAuth 2.1 para clientes publicos). */
  verifyPkce(verifier: string, challenge: string, method: string): boolean {
    if (!verifier || !challenge) return false;
    if (method && method.toUpperCase() !== 'S256') return false;
    const hashed = createHash('sha256')
      .update(verifier)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    // Comparacion en tiempo (longitudes distintas → false rapido).
    return hashed === challenge;
  }

  // ────────────────────────────────────────────────────────────
  //  Emision de tokens
  // ────────────────────────────────────────────────────────────

  async issueTokens(
    userId: string,
    user?: { email?: string; name?: string },
    scope?: string,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    token_type: 'Bearer';
    expires_in: number;
    scope?: string;
  }> {
    const base = {
      sub: userId,
      email: user?.email,
      name: user?.name,
      scope,
    };
    const access_token = await this.jwtService.signAsync(base, {
      secret: this.secret('JWT_SECRET'),
      expiresIn: this.accessTtl,
    });
    const refresh_token = await this.jwtService.signAsync(
      { sub: userId, typ: 'refresh', scope },
      { secret: this.secret('JWT_REFRESH_SECRET'), expiresIn: this.refreshTtl },
    );
    return {
      access_token,
      refresh_token,
      token_type: 'Bearer',
      expires_in: this.accessTtl,
      scope,
    };
  }

  async refreshTokens(refreshToken: string) {
    try {
      const payload: any = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.secret('JWT_REFRESH_SECRET'),
      });
      if (payload?.typ !== 'refresh') return null;
      const user = await this.authService.validateUserById(payload.sub);
      if (!user || !user.isActive) return null;
      return this.issueTokens(
        user.id,
        { email: user.email, name: user.name },
        payload.scope,
      );
    } catch {
      return null;
    }
  }
}
