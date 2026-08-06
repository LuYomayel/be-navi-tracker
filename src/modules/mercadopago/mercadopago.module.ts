import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { ExpensesModule } from '../expenses/expenses.module';
import { MercadoPagoController } from './mercadopago.controller';
import { MercadoPagoService } from './mercadopago.service';

@Module({
  imports: [ExpensesModule],
  controllers: [MercadoPagoController],
  providers: [MercadoPagoService, PrismaService],
  exports: [MercadoPagoService],
})
export class MercadoPagoModule {}
