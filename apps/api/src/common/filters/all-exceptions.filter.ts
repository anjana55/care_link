import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Response } from 'express';
import { translateMessages } from '../i18n/messages';
import type { RequestWithLanguage } from '../i18n/language.middleware';

/**
 * Turns every exception into the API's one error shape, in the caller's language.
 *
 * Services and guards throw English; the translation happens here, in one place,
 * so no endpoint has to know about languages. A message with no translation goes
 * out in English (see common/i18n/messages.ts).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithLanguage>();
    const lang = request.lang ?? 'en';

    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = exception instanceof HttpException ? exception.getResponse() : 'Internal server error';
    const message = typeof body === 'string' ? body : ((body as { message?: unknown }).message ?? body);

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url}`, exception instanceof Error ? exception.stack : undefined);
    }

    response.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: request.url,
      message: translateMessages(message, lang),
    });
  }
}
