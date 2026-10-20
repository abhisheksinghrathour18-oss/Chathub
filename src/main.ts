import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT', 3000);
  const globalPrefix = configService.get<string>('GLOBAL_PREFIX', 'api');

  // Global prefix for all routes (e.g. /api/...)
  app.setGlobalPrefix(globalPrefix);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Global exception filter for consistent error formats
  app.useGlobalFilters(new HttpExceptionFilter());

  // Graceful shutdown hooks
  app.enableShutdownHooks();

  // Swagger OpenAPI Documentation
  const swaggerConfig = new DocumentBuilder()
    .setTitle('ChatHub 1:1 Chat Backend API')
    .setDescription(
      'Professional 1:1 Chat Backend built with NestJS, PostgreSQL, Prisma ORM, and Firebase Firestore.\n\n' +
        '**Architecture Principles**:\n' +
        '- **PostgreSQL**: Users, Chats, Relational Chat Membership (Source of Truth).\n' +
        '- **Firebase Firestore**: Real-time Messages, Per-Message Read Receipts, Per-User Last-Seen Tracking.\n' +
        '- **Concurrency Safety**: Canonical lexicographical ordering and PostgreSQL composite unique constraints prevent duplicate 1:1 chats under race conditions.\n' +
        '- **Backwards-Movement Prevention**: Firestore transactions reject moving last-seen pointers backwards in time.\n\n' +
        '> **Security Note**: In a production deployment, endpoints must extract authenticated user identity from a cryptographically verified JWT or session rather than trusting request body user IDs.',
    )
    .setVersion('1.0')
    .addTag('Health', 'Health checks and uptime monitoring')
    .addTag(
      'Chat',
      '1:1 Chat room management, messaging, read receipts, and last seen tracking',
    )
    .addTag('User', 'User chats and membership queries')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document);

  await app.listen(port);
  logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
  logger.log(
    `📚 Swagger OpenAPI documentation: http://localhost:${port}/${globalPrefix}/docs`,
  );
}

void bootstrap();
