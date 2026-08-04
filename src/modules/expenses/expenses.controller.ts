import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  CategoryDto,
  CreateExpenseDto,
  ExpensesService,
  RecurringDto,
  UpdateExpenseDto,
} from './expenses.service';

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

@Controller('expenses')
@UseGuards(JwtAuthGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  // ── Resumen ──────────────────────────────────────────────
  @Get('summary')
  async summary(@Query('month') month: string, @Req() req: any) {
    return {
      success: true,
      data: await this.expenses.getSummary(
        req.user.userId,
        month || currentMonth(),
      ),
    };
  }

  // ── Categorías ───────────────────────────────────────────
  @Get('categories')
  async categories(@Req() req: any) {
    return {
      success: true,
      data: await this.expenses.getCategories(req.user.userId),
    };
  }

  @Post('categories')
  @HttpCode(HttpStatus.CREATED)
  async createCategory(@Body() dto: CategoryDto, @Req() req: any) {
    return {
      success: true,
      data: await this.expenses.createCategory(req.user.userId, dto),
    };
  }

  @Put('categories/:id')
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: CategoryDto,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.expenses.updateCategory(req.user.userId, id, dto),
    };
  }

  @Delete('categories/:id')
  async deleteCategory(@Param('id') id: string, @Req() req: any) {
    await this.expenses.deleteCategory(req.user.userId, id);
    return { success: true };
  }

  // ── Recurrentes ──────────────────────────────────────────
  @Get('recurring')
  async recurring(@Req() req: any) {
    return {
      success: true,
      data: await this.expenses.getRecurring(req.user.userId),
    };
  }

  @Post('recurring')
  @HttpCode(HttpStatus.CREATED)
  async createRecurring(@Body() dto: RecurringDto, @Req() req: any) {
    return {
      success: true,
      data: await this.expenses.createRecurring(req.user.userId, dto),
    };
  }

  @Put('recurring/:id')
  async updateRecurring(
    @Param('id') id: string,
    @Body() dto: RecurringDto,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.expenses.updateRecurring(req.user.userId, id, dto),
    };
  }

  @Delete('recurring/:id')
  async deleteRecurring(@Param('id') id: string, @Req() req: any) {
    await this.expenses.deleteRecurring(req.user.userId, id);
    return { success: true };
  }

  // ── Gastos ───────────────────────────────────────────────
  @Get()
  async list(@Query('month') month: string, @Req() req: any) {
    return {
      success: true,
      data: await this.expenses.getExpenses(
        req.user.userId,
        month || currentMonth(),
      ),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() dto: CreateExpenseDto, @Req() req: any) {
    return {
      success: true,
      data: await this.expenses.createExpense(req.user.userId, dto),
    };
  }

  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.expenses.updateExpense(req.user.userId, id, dto),
    };
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    await this.expenses.deleteExpense(req.user.userId, id);
    return { success: true };
  }
}
