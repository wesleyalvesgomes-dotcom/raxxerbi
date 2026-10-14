-- Recurrence is intentionally limited to one-time, daily, or weekly jobs.
-- Jobs are created only by an authenticated user and may only run allow-listed summaries.
ALTER TABLE scheduled_jobs
ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'once'
CHECK (recurrence IN ('once', 'daily', 'weekly'));
