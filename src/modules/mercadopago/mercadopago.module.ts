import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { MercadoPagoController } from './mercadopago.controller';
import { MercadoPagoService } from './mercadopago.service';

@Module({
  controllers: [MercadoPagoController],
  providers: [MercadoPagoService, PrismaService],
  exports: [MercadoPagoService],
})
export class MercadoPagoModule {}
