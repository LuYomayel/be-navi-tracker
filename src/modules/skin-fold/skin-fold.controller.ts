import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { SkinFoldService } from './skin-fold.service';
import {
  CreateSkinFoldRecordDto,
  UpdateSkinFoldRecordDto,
} from './dto/skin-fold.dto';

@Controller('skin-fold')
@UseGuards(JwtAuthGuard)
export class SkinFoldController {
  constructor(private readonly skinFoldService: SkinFoldService) {}

  @Get()
  async getRecords(@CurrentUser() user: any) {
    return {
      success: true,
      data: await this.skinFoldService.getAll(user?.id || 'default'),
    };
  }

  @Get('statistics')
  async getStatistics(@CurrentUser() user: any) {
    return {
      success: true,
      data: await this.skinFoldService.getStatistics(user?.id || 'default'),
    };
  }

  @Get(':id')
  async getRecord(@Param('id') id: string, @CurrentUser() user: any) {
    return {
      success: true,
      data: await this.skinFoldService.getById(id, user?.id || 'default'),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createRecord(
    @Body() createDto: CreateSkinFoldRecordDto,
    @CurrentUser() user: any,
  ) {
    return {
      success: true,
      data: await this.skinFoldService.create(createDto, user?.id || 'default'),
    };
  }

  @Put(':id')
  async updateRecord(
    @Param('id') id: string,
    @Body() updateDto: UpdateSkinFoldRecordDto,
    @CurrentUser() user: any,
  ) {
    return {
      success: true,
      data: await this.skinFoldService.update(
        id,
        updateDto,
        user?.id || 'default',
      ),
    };
  }

  @Delete()
  async deleteRecord(@Query('id') id: string, @CurrentUser() user: any) {
    await this.skinFoldService.delete(id, user?.id || 'default');
    return {
      success: true,
      message: 'Registro eliminado correctamente',
    };
  }
}
