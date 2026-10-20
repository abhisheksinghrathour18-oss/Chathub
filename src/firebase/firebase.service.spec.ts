import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { FirebaseService } from './firebase.service';

describe('FirebaseService', () => {
  let service: FirebaseService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FirebaseService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: unknown) => {
              const config: Record<string, unknown> = {
                FIREBASE_PROJECT_ID: 'test-project-id',
                FIRESTORE_EMULATOR_HOST: 'localhost:8080',
              };
              return config[key] ?? defaultValue;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<FirebaseService>(FirebaseService);
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should initialize and provide schema document and collection references', () => {
    service.onModuleInit();

    const chatsCol = service.getChatsCollection();
    expect(chatsCol).toBeDefined();
    expect(chatsCol.id).toBe('chats');

    const chatDoc = service.getChatDocument('chat-123');
    expect(chatDoc).toBeDefined();
    expect(chatDoc.id).toBe('chat-123');

    const messagesCol = service.getMessagesCollection('chat-123');
    expect(messagesCol).toBeDefined();
    expect(messagesCol.id).toBe('messages');

    const messageDoc = service.getMessageDocument('chat-123', 'msg-456');
    expect(messageDoc).toBeDefined();
    expect(messageDoc.id).toBe('msg-456');

    const readReceiptsCol = service.getReadReceiptsCollection(
      'chat-123',
      'msg-456',
    );
    expect(readReceiptsCol).toBeDefined();
    expect(readReceiptsCol.id).toBe('readReceipts');

    const readReceiptDoc = service.getReadReceiptDocument(
      'chat-123',
      'msg-456',
      'user-789',
    );
    expect(readReceiptDoc).toBeDefined();
    expect(readReceiptDoc.id).toBe('user-789');

    const lastSeenCol = service.getLastSeenCollection('chat-123');
    expect(lastSeenCol).toBeDefined();
    expect(lastSeenCol.id).toBe('lastSeen');

    const lastSeenDoc = service.getLastSeenDocument('chat-123', 'user-789');
    expect(lastSeenDoc).toBeDefined();
    expect(lastSeenDoc.id).toBe('user-789');
  });

  it('should return server timestamp FieldValue', () => {
    const timestamp = service.getServerTimestamp();
    expect(timestamp).toBeDefined();
  });
});

