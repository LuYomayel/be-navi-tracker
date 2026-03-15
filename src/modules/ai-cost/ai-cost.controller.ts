import { Controller, Get, Req, UseGuards, HttpException, HttpStatus } from '@nestjs/common';
import { AICostService } from './ai-cost.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('ai-costs')
@UseGuards(JwtAuthGuard)
export class AICostController {
  constructor(private readonly aiCostService: AICostService) {}

  @Get()
  async getStats(@Req() req: any) {
    const userId = req.user?.userId;
    if (!userId) throw new HttpException('No autorizado', HttpStatus.UNAUTHORIZED);
    const stats = await this.aiCostService.getStats(userId);
    return { success: true, data: stats };
  }
}
