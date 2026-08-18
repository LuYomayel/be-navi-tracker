import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { GoalModule } from '../goal/goal.module';
import { PrintingController } from './printing.controller';
import { PrintingService } from './printing.service';
import { SettlementService } from './settlement.service';
import { OrdersService } from './orders.service';
import { StockService } from './stock.service';
import { PhotosService } from './photos.service';
import { BambuService } from './bambu.service';

@Module({
  imports: [GoalModule],
  controllers: [PrintingController],
  providers: [
    PrintingService,
    SettlementService,
    OrdersService,
    StockService,
    PhotosService,
    BambuService,
    PrismaService,
  ],
  exports: [
    PrintingService,
    SettlementService,
    OrdersService,
    StockService,
    BambuService,
  ],
})
export class PrintingModule {}
