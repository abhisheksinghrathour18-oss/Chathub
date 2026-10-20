import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { FirebaseService } from '../src/firebase/firebase.service';

describe('Chat & User API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let userAId: string;
  let userBId: string;
  let userCId: string; // User with no chats initially
  let userDId: string; // Additional user for group testing
  let chatId: string;
  let groupChatId: string;

  beforeAll(async () => {
    interface StoredMessage {
      senderId: string;
      text: string;
      createdAt: { toDate: () => Date };
      editedAt?: { toDate: () => Date };
      deletedAt?: { toDate: () => Date };
      isDeleted?: boolean;
    }

    const messagesStore = new Map<string, StoredMessage>();

    const getDocRef = (msgId: string) => ({
      id: msgId,
      set: jest
        .fn()
        .mockImplementation(
          async (data: { senderId: string; text: string }) => {
            messagesStore.set(msgId, {
              ...data,
              createdAt: { toDate: () => new Date('2026-10-21T00:00:00Z') },
            });
          },
        ),
      update: jest
        .fn()
        .mockImplementation(
          async (data: {
            text?: string;
            isDeleted?: boolean;
            editedAt?: unknown;
            deletedAt?: unknown;
          }) => {
            const existing = messagesStore.get(msgId) || {
              senderId: '',
              text: '',
              createdAt: { toDate: () => new Date('2026-10-21T00:00:00Z') },
            };
            const updated: StoredMessage = {
              ...existing,
              ...(data.text !== undefined ? { text: data.text } : {}),
              ...(data.isDeleted !== undefined
                ? { isDeleted: data.isDeleted }
                : {}),
              ...(data.editedAt !== undefined
                ? {
                    editedAt: {
                      toDate: () => new Date('2026-10-21T00:05:00Z'),
                    },
                  }
                : {}),
              ...(data.deletedAt !== undefined
                ? {
                    deletedAt: {
                      toDate: () => new Date('2026-10-21T00:10:00Z'),
                    },
                  }
                : {}),
            };
            messagesStore.set(msgId, updated);
          },
        ),
      get: jest.fn().mockImplementation(async () => {
        const found = messagesStore.get(msgId);
        return {
          exists: !!found,
          data: () => found,
        };
      }),
    });

    const mockFirebaseService = {
      getMessagesCollection: jest.fn().mockImplementation(() => {
        const queryMock = {
          orderBy: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          startAfter: jest.fn().mockReturnThis(),
          get: jest.fn().mockImplementation(async () => {
            const docs = Array.from(messagesStore.entries()).map(
              ([id, data]) => ({
                id,
                data: () => data,
              }),
            );
            return { docs };
          }),
          doc: jest.fn().mockImplementation((id?: string) => {
            const msgId = id || `msg-e2e-${Date.now()}`;
            return getDocRef(msgId);
          }),
        };
        return queryMock;
      }),
      getMessageDocument: jest
        .fn()
        .mockImplementation((_chatId: string, msgId: string) =>
          getDocRef(msgId),
        ),
      getServerTimestamp: jest.fn().mockReturnValue({}),
      getReadReceiptsCollection: jest.fn(),
      getLastSeenCollection: jest.fn(),
      runTransaction: jest.fn().mockImplementation(
        async (
          callback: (tx: {
            get: (ref: ReturnType<typeof getDocRef>) => Promise<{
              exists: boolean;
              data: () => unknown;
            }>;
            update: (
              ref: ReturnType<typeof getDocRef>,
              data: Record<string, unknown>,
            ) => Promise<void>;
            set: (
              ref: ReturnType<typeof getDocRef>,
              data: Record<string, unknown>,
            ) => Promise<void>;
          }) => Promise<unknown>,
        ) => {
          const tx = {
            get: jest
              .fn()
              .mockImplementation(
                async (docRef: ReturnType<typeof getDocRef>) => {
                  return docRef.get();
                },
              ),
            update: jest
              .fn()
              .mockImplementation(
                async (
                  docRef: ReturnType<typeof getDocRef>,
                  data: Record<string, unknown>,
                ) => {
                  return docRef.update(data);
                },
              ),
            set: jest
              .fn()
              .mockImplementation(
                async (
                  docRef: ReturnType<typeof getDocRef>,
                  data: Record<string, unknown>,
                ) => {
                  return docRef.set(data as { senderId: string; text: string });
                },
              ),
          };
          return callback(tx);
        },
      ),
      onModuleDestroy: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(FirebaseService)
      .useValue(mockFirebaseService)
      .compile();

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
      where: { email: 'alice-e2e-m8@example.com' },
      update: {},
      create: {
        email: 'alice-e2e-m8@example.com',
        name: 'Alice E2E M8',
      },
    });

    const userB = await prisma.user.upsert({
      where: { email: 'bob-e2e-m8@example.com' },
      update: {},
      create: {
        email: 'bob-e2e-m8@example.com',
        name: 'Bob E2E M8',
      },
    });

    const userC = await prisma.user.upsert({
      where: { email: 'charlie-e2e-m8@example.com' },
      update: {},
      create: {
        email: 'charlie-e2e-m8@example.com',
        name: 'Charlie E2E M8',
      },
    });

    const userD = await prisma.user.upsert({
      where: { email: 'david-e2e-m10@example.com' },
      update: {},
      create: {
        email: 'david-e2e-m10@example.com',
        name: 'David E2E M10',
      },
    });

    userAId = userA.id;
    userBId = userB.id;
    userCId = userC.id;
    userDId = userD.id;

    // Clean up test data from any previous test runs
    await prisma.chatMember.deleteMany({
      where: {
        userId: { in: [userA.id, userB.id, userC.id, userD.id] },
      },
    });
    await prisma.chat.deleteMany({
      where: {
        OR: [
          { user1Id: { in: [userA.id, userB.id, userC.id, userD.id] } },
          { user2Id: { in: [userA.id, userB.id, userC.id, userD.id] } },
          { createdById: { in: [userA.id, userB.id, userC.id, userD.id] } },
        ],
      },
    });
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
    expect(response.body.message).toContain('not exist');
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

  it('POST /api/chat/:chatId/lastseen - should reject non-member with 403', async () => {
    const strangerId = '00000000-0000-0000-0000-000000000099';
    await request(app.getHttpServer())
      .post(`/api/chat/${chatId}/lastseen`)
      .send({ userId: strangerId, messageId: 'msg-123' })
      .expect(403);
  });

  it('POST /api/chat/:chatId/lastseen - should reject non-existent chat with 404', async () => {
    const fakeChatId = '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .post(`/api/chat/${fakeChatId}/lastseen`)
      .send({ userId: userAId, messageId: 'msg-123' })
      .expect(404);
  });

  it('GET /api/user/:userId/chats - should reject non-existent user with 404', async () => {
    const fakeUserId = '00000000-0000-0000-0000-000000000000';
    await request(app.getHttpServer())
      .get(`/api/user/${fakeUserId}/chats`)
      .expect(404);
  });

  it('GET /api/user/:userId/chats - should return empty list for user with no chats', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/user/${userCId}/chats`)
      .expect(200);

    expect(response.body).toEqual({
      userId: userCId,
      chats: [],
      totalCount: 0,
    });
  });

  it('GET /api/user/:userId/chats - should return user chats and member IDs', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/user/${userAId}/chats`)
      .expect(200);

    expect(response.body).toHaveProperty('userId', userAId);
    expect(response.body).toHaveProperty('totalCount');
    expect(response.body.totalCount).toBeGreaterThanOrEqual(1);
    expect(response.body.chats[0]).toHaveProperty('chatId', chatId);
    expect(response.body.chats[0].memberIds).toContain(userAId);
    expect(response.body.chats[0].memberIds).toContain(userBId);
  });

  // ==========================================
  // Milestone 10: Group Chat End-to-End Tests
  // ==========================================

  it('POST /api/chat/group/create - should reject blank group name with 400', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/chat/group/create')
      .send({
        name: '   ',
        creatorId: userAId,
        memberIds: [userBId],
      })
      .expect(400);

    expect(response.body).toHaveProperty('message');
  });

  it('POST /api/chat/group/create - should reject non-existent user with 404', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    const response = await request(app.getHttpServer())
      .post('/api/chat/group/create')
      .send({
        name: 'Alpha Squad',
        creatorId: userAId,
        memberIds: [fakeId],
      })
      .expect(404);

    expect(response.body.message).toContain('not exist');
  });

  it('POST /api/chat/group/create - should create group, deduplicate IDs, and assign creator as ADMIN', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/chat/group/create')
      .send({
        name: 'Alpha Squad',
        creatorId: userAId,
        memberIds: [userBId, userAId], // duplicate creatorId passed
      })
      .expect(201);

    expect(response.body).toHaveProperty('chatId');
    groupChatId = response.body.chatId;
    expect(response.body.name).toBe('Alpha Squad');
    expect(response.body.type).toBe('GROUP');
    expect(response.body.creatorId).toBe(userAId);
    expect(response.body.members).toHaveLength(2);

    const creatorMember = response.body.members.find(
      (m: { userId: string; role: string }) => m.userId === userAId,
    );
    expect(creatorMember.role).toBe('ADMIN');
  });

  it('GET /api/chat/group/:chatId - should reject unauthorized non-member with 403', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/chat/group/${groupChatId}?userId=${userCId}`)
      .expect(403);

    expect(response.body.message).toContain('not authorized');
  });

  it('GET /api/chat/group/:chatId - should return group details and members for authorized member', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/chat/group/${groupChatId}?userId=${userAId}`)
      .expect(200);

    expect(response.body).toHaveProperty('chatId', groupChatId);
    expect(response.body.name).toBe('Alpha Squad');
    expect(response.body.memberCount).toBe(2);
    expect(response.body.members[0]).toHaveProperty('name');
    expect(response.body.members[0]).toHaveProperty('email');
  });

  it('POST /api/chat/group/:chatId/members - should reject add member if caller is not an ADMIN with 403', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/chat/group/${groupChatId}/members`)
      .send({
        actingUserId: userBId, // userB is MEMBER
        userId: userCId,
      })
      .expect(403);

    expect(response.body.message).toContain('Only group administrators');
  });

  it('POST /api/chat/group/:chatId/members - should allow ADMIN to add a new member', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/chat/group/${groupChatId}/members`)
      .send({
        actingUserId: userAId, // userA is ADMIN
        userId: userCId,
      })
      .expect(201);

    expect(response.body).toHaveProperty('chatId', groupChatId);
    expect(response.body).toHaveProperty('userId', userCId);
    expect(response.body.role).toBe('MEMBER');
  });

  it('POST /api/chat/group/:chatId/members - should reject duplicate member with 409 Conflict', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/chat/group/${groupChatId}/members`)
      .send({
        actingUserId: userAId,
        userId: userCId,
      })
      .expect(409);

    expect(response.body.message).toContain('already a member');
  });

  it('POST /api/chat/:chatId/message/send - group member can send message, non-member is rejected', async () => {
    // Non-member userD gets 403
    await request(app.getHttpServer())
      .post(`/api/chat/${groupChatId}/message/send`)
      .send({
        senderId: userDId,
        text: 'Unauthorized group intrusion',
      })
      .expect(403);

    // Group member userC gets 201
    const msgRes = await request(app.getHttpServer())
      .post(`/api/chat/${groupChatId}/message/send`)
      .send({
        senderId: userCId,
        text: 'Hello squad from user C!',
      })
      .expect(201);

    expect(msgRes.body).toHaveProperty('id');
    expect(msgRes.body.senderId).toBe(userCId);
    expect(msgRes.body.text).toBe('Hello squad from user C!');
  });

  it('GET /api/chat/:chatId/messages - group member can read messages, non-member is rejected', async () => {
    // Non-member userD gets 403
    await request(app.getHttpServer())
      .get(`/api/chat/${groupChatId}/messages?userId=${userDId}`)
      .expect(403);

    // Member userC gets 200
    const msgListRes = await request(app.getHttpServer())
      .get(`/api/chat/${groupChatId}/messages?userId=${userCId}`)
      .expect(200);

    expect(msgListRes.body).toHaveProperty('messages');
    expect(msgListRes.body.messages.length).toBeGreaterThanOrEqual(1);
  });

  it('DELETE /api/chat/group/:chatId/members/:userId - should reject removal by non-admin with 403', async () => {
    const response = await request(app.getHttpServer())
      .delete(
        `/api/chat/group/${groupChatId}/members/${userCId}?actingUserId=${userBId}`,
      )
      .expect(403);

    expect(response.body.message).toContain('Only group administrators');
  });

  it('DELETE /api/chat/group/:chatId/members/:userId - should prevent removing the last administrator with 400', async () => {
    const response = await request(app.getHttpServer())
      .delete(
        `/api/chat/group/${groupChatId}/members/${userAId}?actingUserId=${userAId}`,
      )
      .expect(400);

    expect(response.body.message).toContain(
      'Cannot remove the last administrator',
    );
  });

  it('DELETE /api/chat/group/:chatId/members/:userId - should allow admin to remove a member', async () => {
    const response = await request(app.getHttpServer())
      .delete(
        `/api/chat/group/${groupChatId}/members/${userCId}?actingUserId=${userAId}`,
      )
      .expect(200);

    expect(response.body).toEqual({
      chatId: groupChatId,
      userId: userCId,
      removed: true,
    });
  });

  it('POST /api/chat/group/:chatId/leave - should prevent last administrator from leaving if other members exist', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/chat/group/${groupChatId}/leave`)
      .send({ userId: userAId })
      .expect(400);

    expect(response.body.message).toContain(
      'Cannot leave group as the last administrator',
    );
  });

  it('POST /api/chat/group/:chatId/leave - should allow regular member to leave group', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/chat/group/${groupChatId}/leave`)
      .send({ userId: userBId })
      .expect(200);

    expect(response.body).toEqual({
      chatId: groupChatId,
      userId: userBId,
      left: true,
    });
  });

  // ==========================================
  // Milestone 11: Message Edit & Delete E2E Tests
  // ==========================================

  let editDeleteMsgId: string;

  it('POST /api/chat/:chatId/message/send - send message for edit/delete lifecycle', async () => {
    const msgRes = await request(app.getHttpServer())
      .post(`/api/chat/${chatId}/message/send`)
      .send({
        senderId: userAId,
        text: 'Initial message for edit/delete test',
      })
      .expect(201);

    expect(msgRes.body).toHaveProperty('id');
    editDeleteMsgId = msgRes.body.id;
    expect(msgRes.body.senderId).toBe(userAId);
  });

  it('PATCH /api/chat/:chatId/message/:messageId - should reject edit with blank text with 400', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/chat/${chatId}/message/${editDeleteMsgId}`)
      .send({
        senderId: userAId,
        text: '   ',
      })
      .expect(400);

    expect(response.body).toHaveProperty('message');
  });

  it('PATCH /api/chat/:chatId/message/:messageId - should reject edit by non-member with 403', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/chat/${chatId}/message/${editDeleteMsgId}`)
      .send({
        senderId: userDId, // userD is not in chat
        text: 'Intruder edit',
      })
      .expect(403);

    expect(response.body.message).toContain('not authorized');
  });

  it('PATCH /api/chat/:chatId/message/:messageId - should reject edit by member who is not the author with 403', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/chat/${chatId}/message/${editDeleteMsgId}`)
      .send({
        senderId: userBId, // userB is member, but author is userA
        text: 'Non-author override of user text',
      })
      .expect(403);

    expect(response.body.message).toContain('not the author');
  });

  it('PATCH /api/chat/:chatId/message/:messageId - should reject edit for non-existent message with 404', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/chat/${chatId}/message/msg-does-not-exist`)
      .send({
        senderId: userAId,
        text: 'Updating a ghost',
      })
      .expect(404);

    expect(response.body.message).toContain('does not exist');
  });

  it('PATCH /api/chat/:chatId/message/:messageId - should allow original author to edit message', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/chat/${chatId}/message/${editDeleteMsgId}`)
      .send({
        senderId: userAId,
        text: 'Hello squad from user A! (edited)',
      })
      .expect(200);

    expect(response.body).toHaveProperty('id', editDeleteMsgId);
    expect(response.body).toHaveProperty('senderId', userAId);
    expect(response.body.text).toBe('Hello squad from user A! (edited)');
    expect(response.body).toHaveProperty('editedAt');
    expect(response.body.isDeleted).toBe(false);
  });

  it('DELETE /api/chat/:chatId/message/:messageId - should reject delete by non-author with 403', async () => {
    const response = await request(app.getHttpServer())
      .delete(
        `/api/chat/${chatId}/message/${editDeleteMsgId}?senderId=${userBId}`,
      )
      .expect(403);

    expect(response.body.message).toContain('not the author');
  });

  it('DELETE /api/chat/:chatId/message/:messageId - should reject delete for non-existent message with 404', async () => {
    const response = await request(app.getHttpServer())
      .delete(`/api/chat/${chatId}/message/msg-fake-id?senderId=${userAId}`)
      .expect(404);

    expect(response.body.message).toContain('does not exist');
  });

  it('DELETE /api/chat/:chatId/message/:messageId - should allow original author to soft-delete message', async () => {
    const response = await request(app.getHttpServer())
      .delete(
        `/api/chat/${chatId}/message/${editDeleteMsgId}?senderId=${userAId}`,
      )
      .expect(200);

    expect(response.body).toHaveProperty('id', editDeleteMsgId);
    expect(response.body).toHaveProperty('senderId', userAId);
    expect(response.body.isDeleted).toBe(true);
    expect(response.body).toHaveProperty('deletedAt');
  });

  it('DELETE /api/chat/:chatId/message/:messageId - repeated deletion request should be idempotent with 200', async () => {
    const response = await request(app.getHttpServer())
      .delete(
        `/api/chat/${chatId}/message/${editDeleteMsgId}?senderId=${userAId}`,
      )
      .expect(200);

    expect(response.body.id).toBe(editDeleteMsgId);
    expect(response.body.isDeleted).toBe(true);
  });

  it('PATCH /api/chat/:chatId/message/:messageId - should reject editing an already deleted message with 400', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/chat/${chatId}/message/${editDeleteMsgId}`)
      .send({
        senderId: userAId,
        text: 'Attempting to revive deleted message',
      })
      .expect(400);

    expect(response.body.message).toContain('Cannot edit a deleted message');
  });

  it('GET /api/chat/:chatId/messages - soft-deleted message text is not exposed in message list', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/chat/${chatId}/messages?userId=${userAId}`)
      .expect(200);

    expect(response.body).toHaveProperty('messages');
    const deletedMsg = response.body.messages.find(
      (m: { id: string }) => m.id === editDeleteMsgId,
    );
    expect(deletedMsg).toBeDefined();
    expect(deletedMsg.text).toBe(''); // Text must be hidden / empty
    expect(deletedMsg.isDeleted).toBe(true);
    expect(deletedMsg).toHaveProperty('deletedAt');
  });
});
