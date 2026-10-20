import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  App,
  applicationDefault,
  cert,
  deleteApp,
  getApps,
  initializeApp,
} from 'firebase-admin/app';
import {
  CollectionReference,
  DocumentReference,
  FieldValue,
  Firestore,
  getFirestore,
} from 'firebase-admin/firestore';
import * as fs from 'fs';

@Injectable()
export class FirebaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FirebaseService.name);
  private firebaseApp!: App;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    const projectId = this.configService.get<string>(
      'FIREBASE_PROJECT_ID',
      'chathub-assessment',
    );
    const serviceAccountPath = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_PATH',
    );
    const clientEmail = this.configService.get<string>('FIREBASE_CLIENT_EMAIL');
    const privateKey = this.configService.get<string>('FIREBASE_PRIVATE_KEY');
    const emulatorHost = this.configService.get<string>(
      'FIRESTORE_EMULATOR_HOST',
    );

    if (emulatorHost) {
      process.env['FIRESTORE_EMULATOR_HOST'] = emulatorHost;
      this.logger.log(`Using Firestore emulator at: ${emulatorHost}`);
    }

    const existingApps = getApps();
    if (existingApps.length > 0 && existingApps[0]) {
      this.firebaseApp = existingApps[0];
      this.logger.log('Reusing existing Firebase App instance');
      return;
    }

    let credential = applicationDefault();

    if (serviceAccountPath && fs.existsSync(serviceAccountPath)) {
      this.logger.log(
        `Initializing Firebase with credentials from: ${serviceAccountPath}`,
      );
      credential = cert(serviceAccountPath);
    } else if (clientEmail && privateKey) {
      this.logger.log(
        'Initializing Firebase with inline environment credentials',
      );
      credential = cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      });
    } else if (process.env['FIRESTORE_EMULATOR_HOST']) {
      this.logger.log(
        'Initializing Firebase in emulator mode (no credentials required)',
      );
    } else {
      this.logger.warn(
        'No Firebase credentials found. Falling back to applicationDefault() credentials.',
      );
    }

    this.firebaseApp = initializeApp({
      credential,
      projectId,
    });

    this.logger.log(
      `Firebase Admin initialized successfully for project: ${projectId}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    if (this.firebaseApp) {
      await deleteApp(this.firebaseApp);
      this.logger.log('Firebase App terminated');
    }
  }

  get firestore(): Firestore {
    return getFirestore(this.firebaseApp);
  }

  runTransaction<T>(
    updateFunction: (transaction: FirebaseFirestore.Transaction) => Promise<T>,
  ): Promise<T> {
    return this.firestore.runTransaction(updateFunction);
  }

  getServerTimestamp(): FieldValue {
    return FieldValue.serverTimestamp();
  }

  getChatsCollection(): CollectionReference {
    return this.firestore.collection('chats');
  }

  getChatDocument(chatId: string): DocumentReference {
    return this.getChatsCollection().doc(chatId);
  }

  getMessagesCollection(chatId: string): CollectionReference {
    return this.getChatDocument(chatId).collection('messages');
  }

  getMessageDocument(chatId: string, messageId: string): DocumentReference {
    return this.getMessagesCollection(chatId).doc(messageId);
  }

  getReadReceiptsCollection(
    chatId: string,
    messageId: string,
  ): CollectionReference {
    return this.getMessageDocument(chatId, messageId).collection(
      'readReceipts',
    );
  }

  getReadReceiptDocument(
    chatId: string,
    messageId: string,
    userId: string,
  ): DocumentReference {
    return this.getReadReceiptsCollection(chatId, messageId).doc(userId);
  }

  getLastSeenCollection(chatId: string): CollectionReference {
    return this.getChatDocument(chatId).collection('lastSeen');
  }

  getLastSeenDocument(chatId: string, userId: string): DocumentReference {
    return this.getLastSeenCollection(chatId).doc(userId);
  }
}
