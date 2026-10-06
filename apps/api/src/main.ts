import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  app.use(helmet());

  // CORS_ORIGIN is a comma-separated allowlist, not a single origin. The API
  // serves more than one browser app: apps/web on :3000 and apps/public-web on
  // :3002. Listing only one silently breaks the other's fetch calls - the
  // browser drops the response, so React Query sees a network error and the
  // data-dependent UI (meta lists, search) silently renders empty rather than
  // failing loudly. Passed as an array so `cors` echoes the matching request
  // origin instead of sending one fixed ACAO header that only one app matches.
  const corsOrigin = config.get<string>('CORS_ORIGIN') ?? 'http://localhost:3000';
  const allowedOrigins = corsOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );
  // The exception filter and language handling are registered in AppModule.

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Care Platform API')
    .setDescription('Caregiver registration, management and verification API')
    .setVersion('0.1.0')
    .addBearerAuth()
    // Documented once for every operation: error and message texts come back in
    // this language (see common/i18n). The Accept-Language header works too.
    .addGlobalParameters({
      name: 'lang',
      in: 'query',
      required: false,
      description: 'Language for messages: en, si or ta. Overrides the Accept-Language header; defaults to English.',
      schema: { type: 'string', enum: ['en', 'si', 'ta'] },
    })
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Mounted at the root, NOT at "api/docs". nginx proxies this app under
  // /api/ and strips that prefix (see deploy/nginx.conf), so a path that
  // repeats it - "api/docs" - is only reachable at the double-prefixed
  // /api/api/docs and 404s at the /api/docs every other client assumes.
  SwaggerModule.setup('docs', app, document);

  const port = config.get<number>('PORT') ?? 3001;
  await app.listen(port);
  console.log(`Care Platform API listening on port ${port}`);
  console.log(`Swagger docs available at http://localhost:${port}/docs`);
}

bootstrap();
