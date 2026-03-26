-- Error logging table for reliability monitoring
-- Used by the watchdog, safeCron, and fetchWithRetry to persist error history
CREATE TABLE IF NOT EXISTS errors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for querying recent errors
CREATE INDEX IF NOT EXISTS idx_errors_created_at ON errors (created_at DESC);

-- Auto-cleanup: delete errors older than 7 days (run via pg_cron or manual cleanup)
-- For now, the /health endpoint reads the last 10 errors.
