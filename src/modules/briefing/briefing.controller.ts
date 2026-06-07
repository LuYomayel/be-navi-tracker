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
  today(@Req() req: any, @Query('date') date?: string) {
    return this.briefing.getByDate(req.user.userId, date);
  }

  /** Historial de briefings en un rango. */
  @Get('range')
  range(
    @Req() req: any,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.briefing.getRange(req.user.userId, from, to);
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
    if (body?.send) {
      return this.briefing.generateAndSend(userId, body?.date);
    }
    const briefing = await this.briefing.generate(userId, body?.date);
    return { briefing, emailSent: false };
  }
}
