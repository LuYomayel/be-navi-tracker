import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BriefingService } from './briefing.service';

@Controller('briefing')
@UseGuards(JwtAuthGuard)
export class BriefingController {
  constructor(private readonly briefing: BriefingService) {}

  /** Briefing persistido del dia (o de `?date=YYYY-MM-DD`). */
  @Get()
  async today(@Req() req: any, @Query('date') date?: string) {
    const data = await this.briefing.getByDate(req.user.userId, date);
    return { success: true, data };
  }

  /** Historial de briefings en un rango. */
  @Get('range')
  async range(
    @Req() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const data = await this.briefing.getRange(req.user.userId, from, to);
    return { success: true, data };
  }

  /**
   * Genera (o regenera) el briefing del dia on-demand. Con `{ send: true }`
   * tambien lo manda por mail.
   */
  @Post('generate')
  async generate(
    @Req() req: any,
    @Body() body: { date?: string; send?: boolean },
  ) {
    const userId = req.user.userId;
    const data = body?.send
      ? await this.briefing.generateAndSend(userId, body?.date)
      : { briefing: await this.briefing.generate(userId, body?.date), emailSent: false };
    return { success: true, data };
  }
}
