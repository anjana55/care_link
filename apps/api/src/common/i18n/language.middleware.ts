import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { resolveLanguage, type Language } from './language';

export type RequestWithLanguage = Request & { lang?: Language };

/**
 * Works out the response language once per request and says which it chose.
 *
 * `Content-Language` tells the caller what it got (it may have asked for a
 * language we do not have), and `Vary` keeps a shared cache from serving a
 * Sinhala answer to someone who asked for Tamil.
 */
@Injectable()
export class LanguageMiddleware implements NestMiddleware {
  use(req: RequestWithLanguage, res: Response, next: NextFunction) {
    const lang = resolveLanguage(req.query?.lang, req.headers['accept-language']);
    req.lang = lang;
    res.setHeader('Content-Language', lang);
    res.vary('Accept-Language');
    next();
  }
}
