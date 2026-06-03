import {
  Controller,
  Delete,
  Get,
  Post,
  Req,
  Res,
  Logger,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Public } from '../auth/decorators/public.decorator';
import { McpAuthService } from './mcp-auth.service';
import { McpServerFactory } from './mcp-server.factory';

/**
 * Endpoint MCP (Streamable HTTP). Vive en la raiz `/mcp` (sin el prefijo global
 * `/api`, ver main.ts). Cada POST resuelve el usuario desde el Bearer token,
 * construye un McpServer stateless y delega el manejo al transporte de la SDK.
 */
@SkipThrottle()
@Public()
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly auth: McpAuthService,
    private readonly factory: McpServerFactory,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response) {
    const token = this.extractBearer(req);
    const ctx = await this.auth.resolveBearer(token);

    if (!ctx) {
      const base = this.auth.baseUrl(req);
      res.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      );
      res.status(401).json({
        jsonrpc: '2.0',
        error: {
          code: -32001,
          message: 'No autorizado: falta o es invalido el Bearer token',
        },
        id: null,
      });
      return;
    }

    // Exponer el auth al transporte (la SDK lee req.auth).
    (req as any).auth = {
      token: token || 'authless',
      clientId: 'navitracker',
      scopes: ctx.scope ? ctx.scope.split(' ') : [],
      extra: { userId: ctx.userId },
    };

    // Server + transporte stateless (uno por request).
    const server = this.factory.build(ctx.userId);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  // GET (SSE server-stream) y DELETE (cierre de sesion) no se usan en modo
  // stateless: respondemos 405 con Allow: POST, como permite la spec.
  @Get()
  @Delete()
  notAllowed(@Res() res: Response) {
    res.setHeader('Allow', 'POST');
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method Not Allowed. Usa POST /mcp.' },
      id: null,
    });
  }

  private extractBearer(req: Request): string | undefined {
    const header = req.headers['authorization'];
    if (!header || Array.isArray(header)) return undefined;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer') return undefined;
    return value;
  }
}
