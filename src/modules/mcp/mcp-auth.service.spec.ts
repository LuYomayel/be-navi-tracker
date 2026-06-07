import { JwtService } from '@nestjs/jwt';
import { McpAuthService } from './mcp-auth.service';

/**
 * Tests del Authorization Server MCP que no requieren base de datos:
 * PKCE, codigos de autorizacion, DCR y emision/validacion de tokens.
 */
describe('McpAuthService', () => {
  const JWT_SECRET = 'super-secret-jwt-key-change-in-production';

  const makeService = (authServiceOverride?: any) => {
    const jwt = new JwtService({ secret: JWT_SECRET });
    const authService =
      authServiceOverride ??
      ({ validateUserById: jest.fn(), login: jest.fn() } as any);
    return new McpAuthService(jwt, authService);
  };

  describe('verifyPkce (S256)', () => {
    // RFC 7636, Apendice B.
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

    it('acepta un verifier valido', () => {
      expect(makeService().verifyPkce(verifier, challenge, 'S256')).toBe(true);
    });

    it('rechaza un verifier incorrecto', () => {
      expect(makeService().verifyPkce('wrong', challenge, 'S256')).toBe(false);
    });

    it('rechaza el metodo plain (OAuth 2.1 exige S256)', () => {
      expect(makeService().verifyPkce(verifier, challenge, 'plain')).toBe(
        false,
      );
    });
  });

  describe('authorization codes', () => {
    it('son de un solo uso', () => {
      const svc = makeService();
      const code = svc.createAuthCode({
        userId: 'u1',
        clientId: 'c1',
        redirectUri: 'https://example.com/cb',
        codeChallenge: 'x',
        codeChallengeMethod: 'S256',
      });
      expect(svc.consumeAuthCode(code)?.userId).toBe('u1');
      expect(svc.consumeAuthCode(code)).toBeNull();
    });

    it('devuelve null para un codigo inexistente', () => {
      expect(makeService().consumeAuthCode('nope')).toBeNull();
    });
  });

  describe('dynamic client registration', () => {
    it('genera un client_id y lo recupera', () => {
      const svc = makeService();
      const client = svc.registerClient({
        redirect_uris: ['https://example.com/cb'],
        client_name: 'Claude',
      });
      expect(client.clientId).toMatch(/^mcp_/);
      expect(svc.getClient(client.clientId)).toBeDefined();
    });

    it('ensureClient acepta client_ids manuales de forma perezosa', () => {
      const svc = makeService();
      const client = svc.ensureClient(
        'manual-client',
        'https://example.com/cb',
      );
      expect(client.clientId).toBe('manual-client');
      expect(client.redirectUris).toContain('https://example.com/cb');
    });
  });

  describe('emision y validacion de tokens', () => {
    it('emite un access token resoluble a un usuario activo', async () => {
      const authService = {
        validateUserById: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'a@b.com',
          name: 'Ada',
          isActive: true,
        }),
      };
      const svc = makeService(authService);
      const tokens = await svc.issueTokens('u1', {
        email: 'a@b.com',
        name: 'Ada',
      });
      expect(tokens.token_type).toBe('Bearer');

      const ctx = await svc.resolveBearer(tokens.access_token);
      expect(ctx?.userId).toBe('u1');
    });

    it('rechaza un refresh token usado como access token', async () => {
      const authService = {
        validateUserById: jest
          .fn()
          .mockResolvedValue({ id: 'u1', isActive: true }),
      };
      const svc = makeService(authService);
      const tokens = await svc.issueTokens('u1');
      expect(await svc.resolveBearer(tokens.refresh_token)).toBeNull();
    });

    it('rechaza un usuario inactivo', async () => {
      const authService = {
        validateUserById: jest
          .fn()
          .mockResolvedValue({ id: 'u1', isActive: false }),
      };
      const svc = makeService(authService);
      const tokens = await svc.issueTokens('u1');
      expect(await svc.resolveBearer(tokens.access_token)).toBeNull();
    });

    it('un refresh token valido renueva el access token', async () => {
      const authService = {
        validateUserById: jest.fn().mockResolvedValue({
          id: 'u1',
          email: 'a@b.com',
          name: 'Ada',
          isActive: true,
        }),
      };
      const svc = makeService(authService);
      const issued = await svc.issueTokens('u1');
      const refreshed = await svc.refreshTokens(issued.refresh_token);
      expect(refreshed?.access_token).toBeDefined();
      const ctx = await svc.resolveBearer(refreshed!.access_token);
      expect(ctx?.userId).toBe('u1');
    });
  });

  describe('modo authless', () => {
    const OLD_ENV = process.env;
    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('resuelve al usuario estatico cuando MCP_AUTH_MODE=none', async () => {
      process.env = {
        ...OLD_ENV,
        MCP_AUTH_MODE: 'none',
        MCP_STATIC_USER_ID: 'demo',
      };
      const ctx = await makeService().resolveBearer(undefined);
      expect(ctx?.userId).toBe('demo');
    });
  });

  describe('hardening de JWT_SECRET (P0)', () => {
    const OLD_ENV = process.env;
    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('falla al emitir tokens en produccion si falta JWT_SECRET', async () => {
      process.env = { ...OLD_ENV, NODE_ENV: 'production' };
      delete process.env.JWT_SECRET;
      delete process.env.JWT_REFRESH_SECRET;
      await expect(makeService().issueTokens('u1')).rejects.toThrow(
        /JWT_SECRET/,
      );
    });
  });

  describe('authless bloqueado en produccion (P0)', () => {
    const OLD_ENV = process.env;
    afterEach(() => {
      process.env = OLD_ENV;
    });

    it('ignora MCP_AUTH_MODE=none en produccion (authMode=oauth)', () => {
      process.env = {
        ...OLD_ENV,
        NODE_ENV: 'production',
        MCP_AUTH_MODE: 'none',
        MCP_STATIC_USER_ID: 'demo',
      };
      expect(makeService().authMode).toBe('oauth');
    });

    it('no resuelve al usuario estatico sin token en produccion', async () => {
      process.env = {
        ...OLD_ENV,
        NODE_ENV: 'production',
        MCP_AUTH_MODE: 'none',
        MCP_STATIC_USER_ID: 'demo',
      };
      expect(await makeService().resolveBearer(undefined)).toBeNull();
    });

    it('ignora MCP_STATIC_TOKEN en produccion', async () => {
      process.env = {
        ...OLD_ENV,
        NODE_ENV: 'production',
        JWT_SECRET: 'x',
        MCP_STATIC_TOKEN: 'fijo',
        MCP_STATIC_USER_ID: 'demo',
      };
      expect(await makeService().resolveBearer('fijo')).toBeNull();
    });

    it('sigue permitiendo authless fuera de produccion', () => {
      process.env = { ...OLD_ENV, NODE_ENV: 'test', MCP_AUTH_MODE: 'none' };
      expect(makeService().authMode).toBe('none');
    });
  });

  describe('allowlist de redirect_uri (P0)', () => {
    it('rechaza un redirect_uri no registrado para un cliente DCR', () => {
      const svc = makeService();
      const client = svc.registerClient({
        redirect_uris: ['https://claude.ai/cb'],
      });
      expect(
        svc.isRedirectUriRegistered(client.clientId, 'https://evil.com/cb'),
      ).toBe(false);
      expect(
        svc.isRedirectUriRegistered(client.clientId, 'https://claude.ai/cb'),
      ).toBe(true);
    });

    it('acepta (pinea) el redirect_uri de un cliente manual no registrado', () => {
      expect(
        makeService().isRedirectUriRegistered('manual', 'https://claude.ai/cb'),
      ).toBe(true);
    });

    it('ensureClient no expande los redirect_uris de un cliente ya registrado', () => {
      const svc = makeService();
      const client = svc.registerClient({
        redirect_uris: ['https://claude.ai/cb'],
      });
      svc.ensureClient(client.clientId, 'https://evil.com/cb');
      expect(svc.getClient(client.clientId)?.redirectUris).toEqual([
        'https://claude.ai/cb',
      ]);
    });
  });
});
