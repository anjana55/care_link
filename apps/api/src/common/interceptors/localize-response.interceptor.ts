import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { translateMessage } from '../i18n/messages';
import type { RequestWithLanguage } from '../i18n/language.middleware';

/**
 * Success responses can carry a human message too ("Registration successful...").
 * Only a top-level string `message` that has a catalogue entry is translated;
 * anything else - data, arrays, a `message` nobody wrote a translation for - is
 * passed through untouched.
 */
@Injectable()
export class LocalizeResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const lang = context.switchToHttp().getRequest<RequestWithLanguage>().lang ?? 'en';
    if (lang === 'en') return next.handle();
    return next.handle().pipe(
      map((body: unknown) => {
        if (body && typeof body === 'object' && !Array.isArray(body) && typeof (body as { message?: unknown }).message === 'string') {
          const original = body as { message: string };
          return { ...original, message: translateMessage(original.message, lang) };
        }
        return body;
      }),
    );
  }
}
