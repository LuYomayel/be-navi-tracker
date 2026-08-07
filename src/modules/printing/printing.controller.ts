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
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import {
  CreateFilamentDto,
  CreatePrintProductDto,
  CreatePrintSaleDto,
  PrintingService,
  UpdateFilamentDto,
  UpdatePrintProductDto,
  UpdatePrintSaleDto,
  UpdatePrintSettingsDto,
} from './printing.service';

/** Rutas autenticadas del negocio 3D (catalogo propio, filamentos, ventas, balance). */
@Controller('printing')
@UseGuards(JwtAuthGuard)
export class PrintingController {
  constructor(private readonly printing: PrintingService) {}

  // ── Catalogo publico (Marcelito, sin auth) ───────────────
  // @Public() salta el JwtAuthGuard de la clase (mismo patron que
  // auth.controller.ts). El token identifica al usuario, no hace falta JWT.
  @Public()
  @Get('catalog/:token')
  async publicCatalog(@Param('token') token: string) {
    return { success: true, data: await this.printing.getPublicCatalog(token) };
  }

  // ── Settings ──────────────────────────────────────────────
  @Get('settings')
  async getSettings(@Req() req: any) {
    return { success: true, data: await this.printing.getSettings(req.user.userId) };
  }

  @Put('settings')
  async updateSettings(@Body() dto: UpdatePrintSettingsDto, @Req() req: any) {
    return {
      success: true,
      data: await this.printing.updateSettings(req.user.userId, dto),
    };
  }

  @Post('settings/regenerate-token')
  @HttpCode(HttpStatus.OK)
  async regenerateToken(@Req() req: any) {
    return {
      success: true,
      data: await this.printing.regenerateToken(req.user.userId),
    };
  }

  // ── Resumen / balance ─────────────────────────────────────
  @Get('summary')
  async summary(@Req() req: any) {
    return { success: true, data: await this.printing.getSummary(req.user.userId) };
  }

  // ── Productos ─────────────────────────────────────────────
  @Get('products')
  async listProducts(@Req() req: any) {
    return { success: true, data: await this.printing.getProducts(req.user.userId) };
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  async createProduct(@Body() dto: CreatePrintProductDto, @Req() req: any) {
    return {
      success: true,
      data: await this.printing.createProduct(req.user.userId, dto),
    };
  }

  @Put('products/:id')
  async updateProduct(
    @Param('id') id: string,
    @Body() dto: UpdatePrintProductDto,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.printing.updateProduct(req.user.userId, id, dto),
    };
  }

  @Delete('products/:id')
  async deleteProduct(@Param('id') id: string, @Req() req: any) {
    await this.printing.deleteProduct(req.user.userId, id);
    return { success: true };
  }

  // ── Filamentos ────────────────────────────────────────────
  @Get('filaments')
  async listFilaments(@Req() req: any) {
    return { success: true, data: await this.printing.getFilaments(req.user.userId) };
  }

  @Post('filaments')
  @HttpCode(HttpStatus.CREATED)
  async createFilament(@Body() dto: CreateFilamentDto, @Req() req: any) {
    return {
      success: true,
      data: await this.printing.createFilament(req.user.userId, dto),
    };
  }

  @Put('filaments/:id')
  async updateFilament(
    @Param('id') id: string,
    @Body() dto: UpdateFilamentDto,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.printing.updateFilament(req.user.userId, id, dto),
    };
  }

  @Delete('filaments/:id')
  async deleteFilament(@Param('id') id: string, @Req() req: any) {
    await this.printing.deleteFilament(req.user.userId, id);
    return { success: true };
  }

  // ── Ventas / muestras ─────────────────────────────────────
  @Get('sales')
  async listSales(@Req() req: any) {
    return { success: true, data: await this.printing.getSales(req.user.userId) };
  }

  @Post('sales')
  @HttpCode(HttpStatus.CREATED)
  async createSale(@Body() dto: CreatePrintSaleDto, @Req() req: any) {
    return {
      success: true,
      data: await this.printing.createSale(req.user.userId, dto),
    };
  }

  @Put('sales/:id')
  async updateSale(
    @Param('id') id: string,
    @Body() dto: UpdatePrintSaleDto,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.printing.updateSale(req.user.userId, id, dto),
    };
  }

  @Delete('sales/:id')
  async deleteSale(@Param('id') id: string, @Req() req: any) {
    await this.printing.deleteSale(req.user.userId, id);
    return { success: true };
  }

  @Patch('sales/:id/liquidar')
  async liquidarSale(@Param('id') id: string, @Req() req: any) {
    return {
      success: true,
      data: await this.printing.liquidarVenta(req.user.userId, id),
    };
  }
}
