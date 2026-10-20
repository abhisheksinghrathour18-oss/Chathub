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
  let chatId: string;

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

    const userA = await prisma.user.upsert({
      where: { email: 'alice-e2e-m6@example.com' },
      update: {},
      create: {
        email: 'alice-e2e-m6@example.com',
        name: 'Alice E2E M6',
      },
    });

    const userB = await prisma.user.upsert({
      where: { email: 'bob-e2e-m6@example.com' },
      update: {},
      create: {
        email: 'bob-e2e-m6@example.com',
        name: 'Bob E2E M6',
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
    chatId = res1.body.chatId;
    expect(typeof chatId).toBe('string');

    const res2 = await request(app.getHttpServer())
      .post('/api/chat/create')
      .send({ userAId: userBId, userBId: userAId })
      .expect(200);

    expect(res2.body.chatId).toBe(chatId);
  });

  it('POST /api/chat/:chatId/message/send - should reject non-member sender with 403', async () => {
    const strangerId = '00000000-0000-0000-0000-000000000099';
    await request(app.getHttpServer())
      .post(`/api/chat/${chatId}/message/send`)
      .send({ senderId: strangerId, text: 'Hello' })
      .expect(403);
  });

  it('POST /api/chat/:chatId/message/send - should reject non-existent chat with 404', async () => {
    const fakeChatId = '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .post(`/api/chat/${fakeChatId}/message/send`)
      .send({ senderId: userAId, text: 'Hello' })
      .expect(404);
  });

  it('GET /api/chat/:chatId/messages - should reject unauthorized non-member with 403', async () => {
    const strangerId = '00000000-0000-0000-0000-000000000099';
    await request(app.getHttpServer())
      .get(`/api/chat/${chatId}/messages?userId=${strangerId}`)
      .expect(403);
  });

  it('GET /api/chat/:chatId/messages - should reject non-existent chat with 404', async () => {
    const fakeChatId = '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .get(`/api/chat/${fakeChatId}/messages?userId=${userAId}`)
      .expect(404);
  });

  it('POST /api/chat/:chatId/message/:messageId/read - should reject non-member with 403', async () => {
    const strangerId = '00000000-0000-0000-0000-000000000099';
    await request(app.getHttpServer())
      .post(`/api/chat/${chatId}/message/msg-123/read`)
      .send({ userId: strangerId })
      .expect(403);
  });

  it('POST /api/chat/:chatId/message/:messageId/read - should reject non-existent chat with 404', async () => {
    const fakeChatId = '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .post(`/api/chat/${fakeChatId}/message/msg-123/read`)
      .send({ userId: userAId })
      .expect(404);
  });
});
