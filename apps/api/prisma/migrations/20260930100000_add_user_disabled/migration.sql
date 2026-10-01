-- Set by an admin: the account can no longer sign in or refresh. Null = active.
ALTER TABLE "User" ADD COLUMN "disabledAt" TIMESTAMP(3);
