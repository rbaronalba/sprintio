-- AlterTable
ALTER TABLE "Board" ADD COLUMN "inviteToken" TEXT;

-- CreateTable
CREATE TABLE "BoardMember" (
    "boardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardMember_pkey" PRIMARY KEY ("boardId","userId")
);

-- CreateTable
CREATE TABLE "CardMember" (
    "cardId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "CardMember_pkey" PRIMARY KEY ("cardId","userId")
);

-- CreateIndex
CREATE INDEX "BoardMember_userId_idx" ON "BoardMember"("userId");

-- CreateIndex
CREATE INDEX "CardMember_userId_idx" ON "CardMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Board_inviteToken_key" ON "Board"("inviteToken");

-- AddForeignKey
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardMember" ADD CONSTRAINT "BoardMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardMember" ADD CONSTRAINT "CardMember_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardMember" ADD CONSTRAINT "CardMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every existing board's owner becomes a member, since access is now membership-based.
INSERT INTO "BoardMember" ("boardId", "userId") SELECT "id", "ownerId" FROM "Board";
