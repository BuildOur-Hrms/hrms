-- When somebody finished setting up their own details after an invite.
--
-- Nullable and never backfilled: everybody already in the system predates the
-- setup step, and stamping them would claim they had seen a form that did not
-- exist. They get the prompt once, like everybody else.
ALTER TABLE "employees" ADD COLUMN "profile_completed_at" TIMESTAMPTZ(6);
