import { Module, Global } from '@nestjs/common';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CONNECTION',
      useFactory: () => {
        const connection = new IORedis(
          process.env.REDIS_URL || 'redis://localhost:6379',
        );
        connection.on('connect', () => console.log('✅ Conectado a Redis'));
        connection.on('error', (err) =>
          console.error('❌ Error de Redis:', err),
        );
        return connection;
      },
    },
    {
      provide: 'BODY_ANALYSIS_QUEUE',
      useFactory: (connection) => {
        const queue = new Queue('bodyAnalysis', { connection });
        console.log('✅ Cola de análisis corporal creada');
        return queue;
      },
      inject: ['REDIS_CONNECTION'],
    },
  ],
  exports: ['BODY_ANALYSIS_QUEUE', 'REDIS_CONNECTION'],
})
export class QueueModule {}
