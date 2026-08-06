import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  Post,
  UnauthorizedException,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { QuickActionsService } from './quick-actions.service';
import { QuickFriendlyErrorsInterceptor } from './quick-friendly-errors.interceptor';

/**
 * Guard por token estático para Atajos de iOS (no pueden renovar JWT).
 * Token en header x-quick-token o query ?key=. Sin QUICK_ACTIONS_TOKEN en el
 * .env, el módulo queda deshabilitado.
 */
@Injectable()
export class QuickTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const expected = process.env.QUICK_ACTIONS_TOKEN;
    if (!expected) {
      throw new UnauthorizedException('Quick actions deshabilitadas');
    }
    const req = ctx.switchToHttp().getRequest();
    const provided = req.headers['x-quick-token'] || req.query?.key || '';
    const a = Buffer.from(String(provided));
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Token inválido');
    }
    return true;
  }
}

@Controller('quick')
@UseGuards(QuickTokenGuard)
@UseInterceptors(QuickFriendlyErrorsInterceptor)
export class QuickActionsController {
  constructor(
    private readonly quick: QuickActionsService,
    private readonly prisma: PrismaService,
  ) {}

  private async userId(): Promise<string> {
    const email = process.env.MP_SYNC_USER_EMAIL || undefined;
    const user = await this.prisma.user.findFirst({
      where: email ? { email } : undefined,
      orderBy: { createdAt: 'asc' },
    });
    if (!user) throw new UnauthorizedException('No hay usuario');
    return user.id;
  }

  @Post('agua')
  async agua(@Body() body: { vasos?: number }) {
    // Sin vasos explícitos manda la config (vasos por tap del panel)
    return this.quick.agua(
      await this.userId(),
      body?.vasos ? Number(body.vasos) : undefined,
    );
  }

  @Post('comida-plan')
  async comidaPlan() {
    return this.quick.comidaPlan(await this.userId());
  }

  @Post('comida')
  async comida(@Body() body: { texto: string }) {
    return this.quick.comida(await this.userId(), String(body?.texto || ''));
  }

  @Post('entreno')
  async entreno(
    @Body()
    body: {
      minutos?: number;
      kcal?: number;
      distancia_km?: number;
      tipo?: string;
    },
  ) {
    return this.quick.entreno(await this.userId(), {
      minutos: body?.minutos ? Number(body.minutos) : undefined,
      kcal: body?.kcal ? Number(body.kcal) : undefined,
      distancia_km: body?.distancia_km ? Number(body.distancia_km) : undefined,
      tipo: body?.tipo ? String(body.tipo) : undefined,
    });
  }

  @Post('gasto')
  async gasto(
    @Body()
    body: { monto: number; descripcion: string; tarjeta?: boolean | string },
  ) {
    // tarjeta: true = crédito con la Visa propia; texto = otra tarjeta ("Hermano")
    const tarjeta =
      typeof body?.tarjeta === 'string' ? body.tarjeta : !!body?.tarjeta;
    return this.quick.gasto(
      await this.userId(),
      Number(body?.monto),
      String(body?.descripcion || 'Gasto rápido'),
      tarjeta,
    );
  }

  @Post('nota')
  async nota(@Body() body: { texto: string; mood?: number }) {
    return this.quick.nota(
      await this.userId(),
      String(body?.texto || ''),
      body?.mood !== undefined ? Number(body.mood) : undefined,
    );
  }
}
