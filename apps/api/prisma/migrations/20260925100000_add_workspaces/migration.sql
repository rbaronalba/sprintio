-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Workspace_ownerId_idx" ON "Workspace"("ownerId");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one default workspace per existing board owner, holding all their boards.
INSERT INTO "Workspace" ("id", "name", "ownerId")
SELECT 'ws' || md5("ownerId"), 'My workspace', "ownerId" FROM (SELECT DISTINCT "ownerId" FROM "Board") o;

-- AlterTable
ALTER TABLE "Board" ADD COLUMN "workspaceId" TEXT;
UPDATE "Board" SET "workspaceId" = 'ws' || md5("ownerId");
ALTER TABLE "Board" ALTER COLUMN "workspaceId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Board_workspaceId_idx" ON "Board"("workspaceId");

-- AddForeignKey
ALTER TABLE "Board" ADD CONSTRAINT "Board_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "BoardMember" ADD COLUMN "lastViewedAt" TIMESTAMP(3);
