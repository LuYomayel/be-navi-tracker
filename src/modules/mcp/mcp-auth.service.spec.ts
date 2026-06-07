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
});
