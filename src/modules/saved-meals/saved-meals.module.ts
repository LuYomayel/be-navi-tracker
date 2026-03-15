import { Module } from '@nestjs/common';
import { SavedMealsService } from './saved-meals.service';
import { SavedMealsController } from './saved-meals.controller';
import { PrismaService } from '../../config/prisma.service';

@Module({
  controllers: [SavedMealsController],
  providers: [SavedMealsService, PrismaService],
  exports: [SavedMealsService],
})
export class SavedMealsModule {}
