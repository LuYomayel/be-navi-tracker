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
import { Throttle } from '@nestjs/throttler';
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
      data: await this.skinFoldService.getAll(user?.userId || 'default'),
    };
  }

  @Get('statistics')
  async getStatistics(@CurrentUser() user: any) {
    return {
      success: true,
      data: await this.skinFoldService.getStatistics(
        user?.userId || 'default',
      ),
    };
  }

  @Get(':id')
  async getRecord(@Param('id') id: string, @CurrentUser() user: any) {
    return {
      success: true,
      data: await this.skinFoldService.getById(
        id,
        user?.userId || 'default',
      ),
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
      data: await this.skinFoldService.create(
        createDto,
        user?.userId || 'default',
      ),
    };
  }

  // Llama a OpenAI Vision con el PDF de antropometria: limite propio para que
  // no se pueda quemar la cuenta de OpenAI a fuerza de requests.
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('analyze-pdf')
  async analyzePdf(
    @Body() body: { images: string[]; user?: { age: number; gender: string } },
    @CurrentUser() user: any,
  ) {
    const userId = user?.userId || 'default';
    const result = await this.skinFoldService.analyzeAnthropometryPdf(
      body.images,
      userId,
    );

    return {
      success: true,
      data: result,
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
        user?.userId || 'default',
      ),
    };
  }

  @Delete()
  async deleteRecord(@Query('id') id: string, @CurrentUser() user: any) {
    await this.skinFoldService.delete(id, user?.userId || 'default');
    return {
      success: true,
      message: 'Registro eliminado correctamente',
    };
  }
}
