import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log(' Seeding database...');

  // Create or upsert test users
  const userA = await prisma.user.upsert({
    where: { email: 'abhisheksharma@example.com' },
    update: {},
    create: {
      email: 'abhisheksharma@example.com',
      name: 'Abhishek Sharma',
    },
  });

  const userB = await prisma.user.upsert({
    where: { email: 'bobbydeol@example.com' },
    update: {},
    create: {
      email: 'bobbydeol@example.com',
      name: 'Bobby Deol',
    },
  });

  console.log(`✅ Seeded User A: ${userA.name} (${userA.id})`);
  console.log(`✅ Seeded User B: ${userB.name} (${userB.id})`);

  // Canonical ordering for 1:1 chat
  const [user1Id, user2Id] =
    userA.id < userB.id ? [userA.id, userB.id] : [userB.id, userA.id];

  // Atomic creation of chat and members via transaction
  const chat = await prisma.$transaction(async (tx) => {
    // Check if chat already exists
    const existing = await tx.chat.findUnique({
      where: {
        user1Id_user2Id: { user1Id, user2Id },
      },
      include: { members: true },
    });

    if (existing) {
      console.log(`ℹ️ Chat already exists between Alice & Bob: ${existing.id}`);
      return existing;
    }

    // Create chat
    const newChat = await tx.chat.create({
      data: {
        user1Id,
        user2Id,
      },
    });

    // Create membership records atomically
    await tx.chatMember.createMany({
      data: [
        { chatId: newChat.id, userId: userA.id },
        { chatId: newChat.id, userId: userB.id },
      ],
    });

    console.log(`✅ Created 1:1 Chat: ${newChat.id} with 2 members atomically`);
    return newChat;
  });

  console.log(`🎉 Seeding completed. Active chat ID: ${chat.id}`);
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
