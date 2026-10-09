import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';
import { PrismaService } from '../../config/prisma.service';
import { XpModule } from '../xp/xp.module';

@Module({
  imports: [XpModule],
  controllers: [TasksController, ProjectsController],
  providers: [TasksService, ProjectsService, PrismaService],
  exports: [TasksService, ProjectsService],
})
export class TasksModule {}
