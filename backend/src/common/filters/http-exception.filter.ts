import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { SetupError, setupDiagnostic, setupFailure } from '../database/onboarding-errors';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof SetupError ? HttpStatus.SERVICE_UNAVAILABLE : exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof SetupError ? setupFailure(exception, 'DATABASE') : exception instanceof HttpException
        ? exception.getResponse()
        : null;

    let message = 'Internal server error';
    let errors: any = null;
    const metadata: Record<string, unknown> = {};

    if (typeof exceptionResponse === 'string') {
      message = exceptionResponse;
    } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const resObj = exceptionResponse as Record<string, any>;
      message = resObj.message || message;
      errors = resObj.errors || (Array.isArray(resObj.message) ? resObj.message : null);
      for (const key of ['code', 'stage', 'retryable', 'nextAction', 'onboardingId']) {
        if (resObj[key] !== undefined) metadata[key] = resObj[key];
      }
    } else if (process.env.NODE_ENV !== 'production' && exception instanceof Error) {
      message = exception.message;
    }

    const setupRequest = request.url.includes('/onboarding') || request.url === '/api/superadmin/companies';
    if (setupRequest && !(exception instanceof HttpException) && !(exception instanceof SetupError)) message = 'The setup request could not be confirmed. Check its saved reference before trying again.';
    const logMessage = setupRequest ? JSON.stringify({ ...setupDiagnostic(exception), requestId: (request as any).requestId }) : exception instanceof Error ? exception.message : String(message);
    this.logger.error(
      `HTTP ${status} Error on ${request.method} ${request.url}: ${logMessage}`,
      !setupRequest && exception instanceof Error ? exception.stack : '',
    );

    response.status(status).json({
      success: false,
      statusCode: status,
      message: Array.isArray(message) ? message[0] : message,
      errors,
      ...metadata,
      path: request.url,
      requestId: (request as any).requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
