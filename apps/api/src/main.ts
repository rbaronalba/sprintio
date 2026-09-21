import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  // Without an explicit origin cors falls back to '*', which silently defeats credentialed CORS.
  if (!process.env.WEB_ORIGIN) throw new Error('WEB_ORIGIN is not set');

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // One trusted hop (nginx): the throttler must key on the real client IP, not the proxy's.
  // The api port is bound to localhost in docker-compose, so clients cannot spoof X-Forwarded-For.
  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.enableCors({ origin: process.env.WEB_ORIGIN, credentials: true });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
