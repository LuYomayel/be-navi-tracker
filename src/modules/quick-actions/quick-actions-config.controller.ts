import { Body, Controller, Get, Put, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  QuickActionsConfig,
  QuickActionsService,
} from './quick-actions.service';

/** Config del panel de Ajustes (auth normal de la app, no el token estático). */
@Controller('quick-actions/config')
@UseGuards(JwtAuthGuard)
export class QuickActionsConfigController {
  constructor(private readonly quick: QuickActionsService) {}

  @Get()
  async get(@Req() req: any) {
    return {
      success: true,
      data: await this.quick.getConfig(req.user.userId),
    };
  }

  @Put()
  async put(@Body() body: Partial<QuickActionsConfig>, @Req() req: any) {
    return {
      success: true,
      data: await this.quick.setConfig(req.user.userId, {
        aguaVasosPorTap: body?.aguaVasosPorTap,
        notaMoodDefault: body?.notaMoodDefault,
        gastoCategoriaDefault:
          body?.gastoCategoriaDefault === undefined
            ? undefined
            : body.gastoCategoriaDefault || null,
      }),
    };
  }
}
