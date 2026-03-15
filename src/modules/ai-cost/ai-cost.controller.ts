import { Controller, Get, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { AICostService } from './ai-cost.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('ai-cost')
@UseGuards(JwtAuthGuard)
export class AICostController {
  constructor(private readonly aiCostService: AICostService) {}

  @Get('stats')
  async getStats(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    const stats = await this.aiCostService.getStats(userId);

    // Transform byService from Record to Array for frontend compatibility
    const byServiceArray = Object.entries(stats.byService).map(([service, data]) => ({
      service,
      calls: data.calls,
      cost: Number(data.cost.toFixed(4)),
    }));

    return {
      success: true,
      data: {
        ...stats,
        byService: byServiceArray,
      },
    };
  }
}
