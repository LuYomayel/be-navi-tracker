import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TrelloService } from './trello.service';

@Controller('trello')
@UseGuards(JwtAuthGuard)
export class TrelloController {
  constructor(private readonly trello: TrelloService) {}

  /** GET /api/trello/tickets → tickets por board y bucket (cache 2 min) */
  @Get('tickets')
  async tickets() {
    return { success: true, data: await this.trello.getMyTicketsCached() };
  }
}
