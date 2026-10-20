import { ConfigService } from '@nestjs/config';
import { FirebaseService } from '../src/firebase/firebase.service';

async function verifyFirebase(): Promise<void> {
  console.log('🔥 Initializing Firebase Verification...');

  const configService = new ConfigService({
    FIREBASE_PROJECT_ID: 'chathub-assessment',
    FIRESTORE_EMULATOR_HOST:
      process.env['FIRESTORE_EMULATOR_HOST'] || 'localhost:8080',
  });

  const firebaseService = new FirebaseService(configService);
  firebaseService.onModuleInit();

  const dummyChatId = 'chat-demo-123';
  const dummyMessageId = 'msg-demo-456';
  const dummyUserId = 'user-demo-789';

  console.log('\n📁 Verifying Schema Document Paths:');
  console.log(
    `1. Chat Document Path:        ${firebaseService.getChatDocument(dummyChatId).path}`,
  );
  console.log(
    `2. Message Document Path:     ${firebaseService.getMessageDocument(dummyChatId, dummyMessageId).path}`,
  );
  console.log(
    `3. Read Receipt Path:         ${firebaseService.getReadReceiptDocument(dummyChatId, dummyMessageId, dummyUserId).path}`,
  );
  console.log(
    `4. Last Seen Document Path:   ${firebaseService.getLastSeenDocument(dummyChatId, dummyUserId).path}`,
  );

  console.log('\n⏱️ Verifying Server Timestamp generation:');
  const serverTimestamp = firebaseService.getServerTimestamp();
  console.log('Server Timestamp FieldValue is defined:', !!serverTimestamp);

  await firebaseService.onModuleDestroy();
  console.log('\n✅ Firebase Verification completed successfully!');
}

verifyFirebase().catch((err) => {
  console.error('❌ Firebase verification error:', err);
  process.exit(1);
});

