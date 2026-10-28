import { Module } from '@nestjs/common';
import { PrismaService } from '../../config/prisma.service';
import { GoalModule } from '../goal/goal.module';
import { PrintingController } from './printing.controller';
import { PrintingService } from './printing.service';
import { SettlementService } from './settlement.service';
import { OrdersService } from './orders.service';
import { ResellersService } from './resellers.service';
import { StockService } from './stock.service';
import { PhotosService } from './photos.service';
import { BambuService } from './bambu.service';
import { PartsService } from './parts.service';

@Module({
  imports: [GoalModule],
  controllers: [PrintingController],
  providers: [
    PrintingService,
    SettlementService,
    OrdersService,
    ResellersService,
    StockService,
    PhotosService,
    BambuService,
    PartsService,
    PrismaService,
  ],
  exports: [
    PrintingService,
    SettlementService,
    OrdersService,
    ResellersService,
    StockService,
    BambuService,
    PartsService,
  ],
})
export class PrintingModule {}
