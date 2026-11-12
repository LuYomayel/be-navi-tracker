import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CountersService } from './counters.service';
import { getLocalDateString } from '../../common/utils/date.utils';

@Controller('counters')
@UseGuards(JwtAuthGuard)
export class CountersController {
  constructor(private readonly counters: CountersService) {}

  /** GET /api/counters?date=YYYY-MM-DD → { key: valor } del día */
  @Get()
  async getDay(@Query('date') date: string, @Req() req: any) {
    return {
      success: true,
      data: await this.counters.getDay(req.user.userId, date || getLocalDateString()),
    };
  }

  /** POST /api/counters/adjust { key, delta, date? } → { key, value } */
  @Post('adjust')
  async adjust(
    @Body() body: { key: string; delta: number; date?: string },
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.counters.adjust(
        req.user.userId,
        body.date || getLocalDateString(),
        body.key,
        Number(body.delta),
      ),
    };
  }
}
