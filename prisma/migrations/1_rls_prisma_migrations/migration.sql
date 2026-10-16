-- The migrations table itself lives in public and is created by Prisma on
-- the first resolve; it gets row-level security like every other table.
-- IF EXISTS: when migrate dev replays the history on its shadow database,
-- that table is never created there, and a plain ALTER would fail the replay.
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
