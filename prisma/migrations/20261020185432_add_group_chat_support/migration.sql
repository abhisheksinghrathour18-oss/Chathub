-- CreateEnum
CREATE TYPE "ChatType" AS ENUM ('DIRECT', 'GROUP');

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('ADMIN', 'MEMBER');

-- AlterTable
ALTER TABLE "chat_members" ADD COLUMN     "role" "MemberRole" NOT NULL DEFAULT 'MEMBER';

-- AlterTable
ALTER TABLE "chats" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "type" "ChatType" NOT NULL DEFAULT 'DIRECT',
ALTER COLUMN "user1Id" DROP NOT NULL,
ALTER COLUMN "user2Id" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "chats_type_idx" ON "chats"("type");

-- AddForeignKey
ALTER TABLE "chats" ADD CONSTRAINT "chats_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
