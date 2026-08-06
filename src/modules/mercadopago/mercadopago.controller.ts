import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MercadoPagoService } from './mercadopago.service';

@Controller('mercadopago')
@UseGuards(JwtAuthGuard)
export class MercadoPagoController {
  constructor(private readonly mp: MercadoPagoService) {}

  @Post('sync')
  async sync(
    @Body() body: { from?: string; to?: string; dryRun?: boolean },
  ) {
    return {
      success: true,
      data: await this.mp.sync({
        from: body?.from,
        to: body?.to,
        dryRun: body?.dryRun,
      }),
    };
  }

  @Get('status')
  async status(@Req() req: any) {
    return {
      success: true,
      data: await this.mp.getStatus(req.user.userId),
    };
  }
}
