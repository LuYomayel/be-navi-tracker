import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DeviceTokensService } from './device-tokens.service';

@Controller('device-tokens')
@UseGuards(JwtAuthGuard)
export class DeviceTokensController {
  constructor(private readonly deviceTokens: DeviceTokensService) {}

  /** Registra (o reasigna) el push token del dispositivo. */
  @Post()
  async register(
    @Req() req: any,
    @Body() body: { token: string; platform: string },
  ) {
    const data = await this.deviceTokens.register(
      req.user.userId,
      body.token,
      body.platform,
    );
    return { success: true, data };
  }

  /** Desregistra un token (logout / desinstalacion logica). */
  @Delete(':token')
  async remove(@Req() req: any, @Param('token') token: string) {
    const data = await this.deviceTokens.remove(req.user.userId, token);
    return { success: true, data };
  }
}
