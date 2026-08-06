import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

/**
 * Los Atajos de iOS muestran el campo `message` de la respuesta en una
 * notificación. Si un quick action falla, en vez del "Validation failed"
 * genérico del filtro global devolvemos 200 con el motivo real legible.
 * (Los errores de auth del guard NO pasan por acá: siguen siendo 401.)
 */
@Injectable()
export class QuickFriendlyErrorsInterceptor implements NestInterceptor {
  intercept(
    _ctx: ExecutionContext,
    next: CallHandler,
  ): Observable<{ message: string }> {
    return next.handle().pipe(
      catchError((err) => {
        let msg = 'Algo falló, probá de nuevo';
        if (err instanceof HttpException) {
          const res = err.getResponse();
          const raw =
            typeof res === 'string' ? res : (res as any)?.message || err.message;
          msg = Array.isArray(raw) ? raw.join(', ') : String(raw);
        }
        return of({ message: `⚠️ ${msg}` });
      }),
    );
  }
}
