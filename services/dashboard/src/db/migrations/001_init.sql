PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  target_url TEXT NOT NULL,
  total_executions INTEGER NOT NULL CHECK (total_executions > 0),
  distribution_hours REAL NOT NULL CHECK (distribution_hours >= 0),
  locales_json TEXT NOT NULL,
  regions_json TEXT NOT NULL,
  max_parallel_threads INTEGER NOT NULL CHECK (max_parallel_threads > 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled')),
  completed_executions INTEGER NOT NULL DEFAULT 0,
  failed_executions INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  dispatch_index INTEGER,
  agent_profile_index INTEGER,
  proxy_route_id TEXT,
  workflow_json TEXT NOT NULL DEFAULT '{}',
  proxy_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  thread_id TEXT NOT NULL,
  status_code TEXT NOT NULL,
  message TEXT,
  user_agent TEXT NOT NULL,
  locale TEXT NOT NULL,
  region TEXT NOT NULL,
  timezone_id TEXT,
  viewport_width INTEGER NOT NULL,
  viewport_height INTEGER NOT NULL,
  device_scale_factor REAL NOT NULL,
  proxy_route_id TEXT NOT NULL,
  duration_ms INTEGER,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status_created_at ON tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_logs_task_created_at ON execution_logs(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_execution_logs_status_created_at ON execution_logs(status_code, created_at);
