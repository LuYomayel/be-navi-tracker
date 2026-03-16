import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ShoppingListService } from './shopping-list.service';
import {
  CreateShoppingListDto,
  UpdateShoppingListDto,
  GenerateShoppingListDto,
  CreateShoppingItemDto,
  UpdateShoppingItemDto,
  BulkCheckDto,
} from './dto/shopping-list.dto';

@Controller('shopping-list')
@UseGuards(JwtAuthGuard)
export class ShoppingListController {
  constructor(private readonly shoppingListService: ShoppingListService) {}

  // === LISTS ===

  @Get()
  async getAllLists(@Request() req) {
    const data = await this.shoppingListService.getAllLists(req.user.userId);
    return { success: true, data };
  }

  @Post()
  async createList(@Request() req, @Body() dto: CreateShoppingListDto) {
    const data = await this.shoppingListService.createList(
      req.user.userId,
      dto,
    );
    return { success: true, data };
  }

  @Post('generate')
  async generateFromMealPrep(
    @Request() req,
    @Body() dto: GenerateShoppingListDto,
  ) {
    const data = await this.shoppingListService.generateFromMealPrep(
      req.user.userId,
      dto,
    );
    return { success: true, data };
  }

  @Get(':id')
  async getListById(@Request() req, @Param('id') id: string) {
    const data = await this.shoppingListService.getListById(
      id,
      req.user.userId,
    );
    return { success: true, data };
  }

  @Put(':id')
  async updateList(
    @Request() req,
    @Param('id') id: string,
    @Body() dto: UpdateShoppingListDto,
  ) {
    const data = await this.shoppingListService.updateList(
      id,
      req.user.userId,
      dto,
    );
    return { success: true, data };
  }

  @Delete(':id')
  async deleteList(@Request() req, @Param('id') id: string) {
    const data = await this.shoppingListService.deleteList(
      id,
      req.user.userId,
    );
    return { success: true, data };
  }

  // === ITEMS ===

  @Post(':id/items')
  async addItem(
    @Request() req,
    @Param('id') listId: string,
    @Body() dto: CreateShoppingItemDto,
  ) {
    const data = await this.shoppingListService.addItem(
      listId,
      req.user.userId,
      dto,
    );
    return { success: true, data };
  }

  @Put(':id/items/:itemId')
  async updateItem(
    @Request() req,
    @Param('id') listId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateShoppingItemDto,
  ) {
    const data = await this.shoppingListService.updateItem(
      listId,
      itemId,
      req.user.userId,
      dto,
    );
    return { success: true, data };
  }

  @Delete(':id/items/:itemId')
  async deleteItem(
    @Request() req,
    @Param('id') listId: string,
    @Param('itemId') itemId: string,
  ) {
    const data = await this.shoppingListService.deleteItem(
      listId,
      itemId,
      req.user.userId,
    );
    return { success: true, data };
  }

  @Post(':id/items/bulk-check')
  async bulkCheck(
    @Request() req,
    @Param('id') listId: string,
    @Body() dto: BulkCheckDto,
  ) {
    const data = await this.shoppingListService.bulkCheck(
      listId,
      req.user.userId,
      dto,
    );
    return { success: true, data };
  }

  @Post(':id/uncheck-all')
  async uncheckAll(@Request() req, @Param('id') listId: string) {
    const data = await this.shoppingListService.uncheckAll(
      listId,
      req.user.userId,
    );
    return { success: true, data };
  }
}
