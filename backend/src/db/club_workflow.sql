-- Gather club workflow migration
-- Run this once against the database after the base schema exists.
-- The statements are idempotent and do not delete existing data.

BEGIN;

CREATE TABLE IF NOT EXISTS clubs (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(160) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    category VARCHAR(80) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    approved_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS club_members (
    club_id BIGINT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member'
        CHECK (role IN ('lead', 'admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (club_id, user_id)
);

ALTER TABLE events
    ADD COLUMN IF NOT EXISTS club_id BIGINT
    REFERENCES clubs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clubs_status
    ON clubs(status);

CREATE INDEX IF NOT EXISTS idx_club_members_user
    ON club_members(user_id);

CREATE INDEX IF NOT EXISTS idx_events_club
    ON events(club_id);

COMMIT;

-- Workflow:
-- 1. A logged-in student POSTs to /api/v1/clubs.
-- 2. The new club starts with status = 'pending'.
-- 3. The submitting student is inserted into club_members as role = 'lead'.
-- 4. An ADMIN reviews /api/v1/clubs?status=pending.
-- 5. The ADMIN approves with PATCH /api/v1/clubs/:id/approval
--    and body {"status":"approved"}.
-- 6. The approved lead creates an event with its club_id.
-- 7. Students receive club_name with published events.
