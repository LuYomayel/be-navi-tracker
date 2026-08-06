import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CardStatementService } from './card-statement.service';

@Controller('expenses/card-statement')
@UseGuards(JwtAuthGuard)
export class CardStatementController {
  constructor(private readonly cardStatement: CardStatementService) {}

  @Post('parse')
  @Throttle({ default: { ttl: 60000, limit: 3 } })
  async parse(@Body() body: { images: string[] }, @Req() req: any) {
    return {
      success: true,
      data: await this.cardStatement.parseStatement(
        req.user.userId,
        body?.images || [],
      ),
    };
  }

  @Post('confirm')
  async confirm(
    @Body()
    body: {
      statementKey: string;
      dueDate: string;
      movements: {
        date?: string;
        description: string;
        amount: number;
        categoryId?: string | null;
      }[];
    },
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.cardStatement.confirmImport(req.user.userId, body),
    };
  }
}
