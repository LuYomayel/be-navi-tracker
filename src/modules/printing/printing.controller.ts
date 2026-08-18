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
import { Throttle } from '@nestjs/throttler';
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
import { AddSettlementDto, SettlementService } from './settlement.service';
import {
  CreatePaymentNoticeDto,
  CreatePublicOrderDto,
  OrderStatus,
  OrdersService,
} from './orders.service';
import { CreatePrintJobDto, StockService } from './stock.service';
import { PhotosService } from './photos.service';
import { BambuService } from './bambu.service';

/** Rutas autenticadas del negocio 3D (catalogo propio, filamentos, ventas, balance). */
@Controller('printing')
@UseGuards(JwtAuthGuard)
export class PrintingController {
  constructor(
    private readonly printing: PrintingService,
    private readonly settlements: SettlementService,
    private readonly orders: OrdersService,
    private readonly stock: StockService,
    private readonly photos: PhotosService,
    private readonly bambu: BambuService,
  ) {}

  // ── Catalogo publico (Marcelito, sin auth) ───────────────
  // @Public() salta el JwtAuthGuard de la clase (mismo patron que
  // auth.controller.ts). El token identifica al usuario, no hace falta JWT.
  @Public()
  @Get('catalog/:token')
  async publicCatalog(@Param('token') token: string) {
    return { success: true, data: await this.printing.getPublicCatalog(token) };
  }

  /** Marcelito arma su pedido desde el catalogo (sin auth, rate-limiteado). */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post('catalog/:token/orders')
  @HttpCode(HttpStatus.CREATED)
  async publicCreateOrder(
    @Param('token') token: string,
    @Body() dto: CreatePublicOrderDto,
  ) {
    return {
      success: true,
      data: await this.orders.createPublicOrder(token, dto),
    };
  }

  /** Marcelito sigue sus pedidos y ve cuanto debe. */
  @Public()
  @Get('catalog/:token/orders')
  async publicListOrders(@Param('token') token: string) {
    return { success: true, data: await this.orders.getPublicOrders(token) };
  }

  /** "Te pague X": aviso que queda pendiente de confirmacion de Luciano. */
  @Public()
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @Post('catalog/:token/payment-notices')
  @HttpCode(HttpStatus.CREATED)
  async publicPaymentNotice(
    @Param('token') token: string,
    @Body() dto: CreatePaymentNoticeDto,
  ) {
    return {
      success: true,
      data: await this.orders.createPaymentNotice(token, dto),
    };
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

  /** Liquidar todo lo restante de una venta (compat con el flujo viejo). */
  @Patch('sales/:id/liquidar')
  async liquidarSale(@Param('id') id: string, @Req() req: any) {
    const res = await this.settlements.add(req.user.userId, id, {});
    return { success: true, data: res.sale };
  }

  // ── Liquidaciones parciales ───────────────────────────────
  @Get('sales/:id/settlements')
  async listSettlements(@Param('id') id: string, @Req() req: any) {
    return {
      success: true,
      data: await this.settlements.list(req.user.userId, id),
    };
  }

  @Post('sales/:id/settlements')
  @HttpCode(HttpStatus.CREATED)
  async addSettlement(
    @Param('id') id: string,
    @Body() dto: AddSettlementDto,
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.settlements.add(req.user.userId, id, dto),
    };
  }

  @Delete('settlements/:id')
  async deleteSettlement(@Param('id') id: string, @Req() req: any) {
    await this.settlements.remove(req.user.userId, id);
    return { success: true };
  }

  // ── Pedidos (lado Luciano) ────────────────────────────────
  @Get('orders')
  async listOrders(@Req() req: any) {
    return { success: true, data: await this.orders.getOrders(req.user.userId) };
  }

  @Patch('orders/:id/status')
  async updateOrderStatus(
    @Param('id') id: string,
    @Body() body: { status: OrderStatus },
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.orders.updateStatus(req.user.userId, id, body.status),
    };
  }

  @Delete('orders/:id')
  async deleteOrder(@Param('id') id: string, @Req() req: any) {
    await this.orders.deleteOrder(req.user.userId, id);
    return { success: true };
  }

  @Get('payment-notices')
  async listNotices(@Req() req: any) {
    return {
      success: true,
      data: await this.orders.getNotices(req.user.userId),
    };
  }

  @Patch('payment-notices/:id')
  async resolveNotice(
    @Param('id') id: string,
    @Body() body: { status: 'confirmado' | 'descartado' },
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.orders.resolveNotice(req.user.userId, id, body.status),
    };
  }

  // ── Fotos de productos ────────────────────────────────────
  @Post('products/:id/photos')
  @HttpCode(HttpStatus.CREATED)
  async addPhoto(
    @Param('id') id: string,
    @Body() body: { dataUrl: string },
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.photos.addPhoto(req.user.userId, id, body.dataUrl),
    };
  }

  @Delete('photos/:id')
  async deletePhoto(@Param('id') id: string, @Req() req: any) {
    await this.photos.deletePhoto(req.user.userId, id);
    return { success: true };
  }

  @Put('products/:id/photos/order')
  async reorderPhotos(
    @Param('id') id: string,
    @Body() body: { ids: string[] },
    @Req() req: any,
  ) {
    await this.photos.reorder(req.user.userId, id, body.ids ?? []);
    return { success: true };
  }

  // ── Stock ─────────────────────────────────────────────────
  @Get('stock')
  async getStock(@Req() req: any) {
    return { success: true, data: await this.stock.getStock(req.user.userId) };
  }

  /** ¿Alcanza el stock para imprimir estos productos? */
  @Post('stock/check')
  @HttpCode(HttpStatus.OK)
  async checkStock(
    @Body() body: { items: { productId: string; qty: number }[] },
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.stock.check(req.user.userId, body.items ?? []),
    };
  }

  /** "Se me termino este rollo": stock 0 + fecha de agotado. */
  @Post('filaments/:id/finish')
  @HttpCode(HttpStatus.OK)
  async finishFilament(
    @Param('id') id: string,
    @Body() body: { date?: string },
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.stock.finishFilament(req.user.userId, id, body?.date),
    };
  }

  // ── Impresiones ───────────────────────────────────────────
  @Get('jobs')
  async listJobs(@Req() req: any) {
    return { success: true, data: await this.stock.listJobs(req.user.userId) };
  }

  @Post('jobs')
  @HttpCode(HttpStatus.CREATED)
  async createJob(@Body() dto: CreatePrintJobDto, @Req() req: any) {
    return {
      success: true,
      data: await this.stock.createJob(req.user.userId, dto),
    };
  }

  @Delete('jobs/:id')
  async deleteJob(@Param('id') id: string, @Req() req: any) {
    await this.stock.deleteJob(req.user.userId, id);
    return { success: true };
  }

  @Patch('jobs/:id')
  async linkJob(
    @Param('id') id: string,
    @Body() body: { productId: string | null },
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.stock.linkProduct(req.user.userId, id, body.productId),
    };
  }

  /** Copia el consumo real del job al producto (dividido por unidades). */
  @Post('jobs/:id/learn')
  @HttpCode(HttpStatus.OK)
  async learnJob(
    @Param('id') id: string,
    @Body() body: { units: number },
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.stock.learnBreakdown(req.user.userId, id, body.units),
    };
  }

  // ── Bambu Cloud ───────────────────────────────────────────
  @Get('bambu/status')
  async bambuStatus(@Req() req: any) {
    return { success: true, data: await this.bambu.getStatus(req.user.userId) };
  }

  @Post('bambu/connect')
  @HttpCode(HttpStatus.OK)
  async bambuConnect(
    @Body() body: { token: string; region?: 'global' | 'china' },
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.bambu.connect(req.user.userId, body),
    };
  }

  @Delete('bambu')
  async bambuDisconnect(@Req() req: any) {
    return {
      success: true,
      data: await this.bambu.disconnect(req.user.userId),
    };
  }

  @Post('bambu/sync')
  @HttpCode(HttpStatus.OK)
  async bambuSync(
    @Body() body: { importHistory?: boolean },
    @Req() req: any,
  ) {
    return {
      success: true,
      data: await this.bambu.sync(req.user.userId, body ?? {}),
    };
  }
}
