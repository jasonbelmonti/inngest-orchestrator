export const RUN_STORE_SCHEMA_VERSION = 1;

export const RUN_STORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS run_events (
	run_id TEXT NOT NULL,
	sequence INTEGER NOT NULL,
	event_type TEXT NOT NULL,
	occurred_at TEXT NOT NULL,
	payload_json TEXT NOT NULL,
	PRIMARY KEY (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS run_projections (
	run_id TEXT PRIMARY KEY,
	config_root TEXT NOT NULL,
	workflow_id TEXT NOT NULL,
	workflow_name TEXT NOT NULL,
	workflow_summary TEXT,
	workflow_content_hash TEXT NOT NULL,
	workflow_file_path TEXT NOT NULL,
	launch_json TEXT NOT NULL,
	status TEXT NOT NULL,
	current_step_id TEXT,
	latest_event_sequence INTEGER NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	started_at TEXT,
	completed_at TEXT,
	failed_at TEXT,
	cancelled_at TEXT,
	failure_message TEXT
);

CREATE TABLE IF NOT EXISTS approval_requests (
	run_id TEXT NOT NULL,
	approval_id TEXT NOT NULL,
	step_id TEXT NOT NULL,
	status TEXT NOT NULL,
	requested_at TEXT NOT NULL,
	responded_at TEXT,
	decision TEXT,
	message TEXT,
	comment TEXT,
	PRIMARY KEY (run_id, approval_id)
);

CREATE TABLE IF NOT EXISTS artifacts (
	run_id TEXT NOT NULL,
	artifact_id TEXT NOT NULL,
	step_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	repo_id TEXT,
	relative_path TEXT NOT NULL,
	created_at TEXT NOT NULL,
	metadata_json TEXT,
	PRIMARY KEY (run_id, artifact_id)
);

CREATE TABLE IF NOT EXISTS run_event_cursors (
	run_id TEXT PRIMARY KEY,
	last_event_sequence INTEGER NOT NULL,
	updated_at TEXT NOT NULL
);
`;
