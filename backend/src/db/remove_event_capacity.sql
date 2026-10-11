-- Event capacity is no longer used. Ticket types own their availability.
-- Run once against an existing database after the base schema exists.
BEGIN;

ALTER TABLE events
    ALTER COLUMN capacity DROP NOT NULL;

ALTER TABLE events
    DROP CONSTRAINT IF EXISTS events_capacity_check;

COMMIT;
