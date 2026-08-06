import { BadRequestException } from '@nestjs/common';
import { of, throwError, lastValueFrom } from 'rxjs';
import { QuickFriendlyErrorsInterceptor } from './quick-friendly-errors.interceptor';

describe('QuickFriendlyErrorsInterceptor', () => {
  const interceptor = new QuickFriendlyErrorsInterceptor();
  const ctx = {} as any;

  it('should pass through successful responses', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(ctx, { handle: () => of({ message: 'ok' }) }),
    );
    expect(result).toEqual({ message: 'ok' });
  });

  it('should convert HttpExceptions into a friendly message (Shortcuts lo muestra tal cual)', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(ctx, {
        handle: () =>
          throwError(
            () => new BadRequestException('No hay un meal prep activo'),
          ),
      }),
    );
    expect(result.message).toContain('⚠️');
    expect(result.message).toContain('No hay un meal prep activo');
  });

  it('should handle unknown errors with a generic message', async () => {
    const result = await lastValueFrom(
      interceptor.intercept(ctx, {
        handle: () => throwError(() => new Error('boom interno')),
      }),
    );
    expect(result.message).toContain('⚠️');
  });
});
