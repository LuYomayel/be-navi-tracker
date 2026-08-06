import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { PrismaService } from '../../config/prisma.service';
import { QuickActionsService } from './quick-actions.service';

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
    return this.quick.agua(await this.userId(), body?.vasos || 1);
  }

  @Post('comida-plan')
  async comidaPlan() {
    return this.quick.comidaPlan(await this.userId());
  }

  @Post('gasto')
  async gasto(@Body() body: { monto: number; descripcion: string }) {
    return this.quick.gasto(
      await this.userId(),
      Number(body?.monto),
      String(body?.descripcion || 'Gasto rápido'),
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
