import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';

@Injectable()
export class RequestMonitoringInterceptor implements NestInterceptor {
  private readonly logger = new Logger(RequestMonitoringInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const suppliedId = String(request.headers['x-request-id'] || '');
    const requestId = /^[a-zA-Z0-9._-]{1,100}$/.test(suppliedId) ? suppliedId : randomUUID();
    const startedAt = Date.now();
    const slowRequestMs = Math.max(100, Number(process.env.SLOW_REQUEST_MS || 1500));

    request.requestId = requestId;
    response.setHeader('x-request-id', requestId);

    return next.handle().pipe(finalize(() => {
      const durationMs = Date.now() - startedAt;
      if (durationMs >= slowRequestMs) {
        this.logger.warn(JSON.stringify({
          event: 'slow_http_request',
          requestId,
          method: request.method,
          path: (request.path || request.originalUrl || request.url).split('?')[0],
          statusCode: response.statusCode,
          durationMs,
          companyId: request.tenantContext?.companyId,
          userId: request.user?.id,
        }));
      }
    }));
  }
}
