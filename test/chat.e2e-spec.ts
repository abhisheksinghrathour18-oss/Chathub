import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Chat API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    // Retrieve or create test users
    const userA = await prisma.user.upsert({
      where: { email: 'alice-e2e@example.com' },
      update: {},
      create: {
        email: 'alice-e2e@example.com',
        name: 'Alice E2E',
      },
    });

    const userB = await prisma.user.upsert({
      where: { email: 'bob-e2e@example.com' },
      update: {},
      create: {
        email: 'bob-e2e@example.com',
        name: 'Bob E2E',
      },
    });

    userAId = userA.id;
    userBId = userB.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('POST /api/chat/create - should reject identical user IDs with 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/chat/create')
      .send({ userAId, userBId: userAId })
      .expect(400);

    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toContain(
      'Cannot create a 1:1 chat between identical user IDs',
    );
  });

  it('POST /api/chat/create - should reject non-existent users with 404', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    const response = await request(app.getHttpServer())
      .post('/api/chat/create')
      .send({ userAId, userBId: fakeId })
      .expect(404);

    expect(response.body).toHaveProperty('message');
    expect(response.body.message).toContain('does not exist');
  });

  it('POST /api/chat/create - should create or return 1:1 chat', async () => {
    const res1 = await request(app.getHttpServer())
      .post('/api/chat/create')
      .send({ userAId, userBId })
      .expect(200);

    expect(res1.body).toHaveProperty('chatId');
    const chatId = res1.body.chatId;
    expect(typeof chatId).toBe('string');

    // Calling with reversed user order must return identical chatId (Idempotency)
    const res2 = await request(app.getHttpServer())
      .post('/api/chat/create')
      .send({ userAId: userBId, userBId: userAId })
      .expect(200);

    expect(res2.body.chatId).toBe(chatId);
  });
});

