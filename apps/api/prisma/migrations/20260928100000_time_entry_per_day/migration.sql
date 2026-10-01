-- Dates are day-level; normalise any stray time component before merging.
UPDATE "TimeEntry" SET "date" = date_trunc('day', "date");

-- Fold duplicate (card, user, day) rows into the oldest one, summing hours and joining notes.
WITH merged AS (
  SELECT (array_agg("id" ORDER BY "createdAt"))[1] AS keep_id,
         LEAST(SUM("hours"), 24) AS hours,
         NULLIF(string_agg("note", '; ' ORDER BY "createdAt"), '') AS note
  FROM "TimeEntry"
  GROUP BY "cardId", "userId", "date"
  HAVING COUNT(*) > 1
)
UPDATE "TimeEntry" t SET "hours" = m.hours, "note" = m.note FROM merged m WHERE t."id" = m.keep_id;

DELETE FROM "TimeEntry" t
USING "TimeEntry" o
WHERE t."cardId" = o."cardId" AND t."userId" = o."userId" AND t."date" = o."date"
  AND (o."createdAt", o."id") < (t."createdAt", t."id");

-- DropIndex
DROP INDEX "TimeEntry_cardId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "TimeEntry_cardId_userId_date_key" ON "TimeEntry"("cardId", "userId", "date");
