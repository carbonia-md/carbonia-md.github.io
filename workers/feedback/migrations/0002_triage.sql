-- 0002_triage.sql - record the GitHub issue chosen by feedback triage.
--
-- Applied with `npx wrangler d1 migrations apply <database-name> --remote`.
-- Null means the row is new, spam, or predates issue tracking. The triage skill
-- sets this value only when a non-spam row reaches status 'triaged'.

ALTER TABLE feedback ADD COLUMN issue_url TEXT;
