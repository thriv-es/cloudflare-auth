-- Migration: 0001 - one_time_tokens, invite template
-- Description: Replace the dual-use of password_reset_tokens with a typed
--              one_time_tokens table that supports all link- and code-based
--              auth flows, and add an invite template type.

-- ============================================================
-- ONE TIME TOKENS TABLE
-- ============================================================
-- Stores tokens and codes for confirmation, recovery (password reset),
-- magic link, email change, OTP, and invite flows. This mirrors
-- Supabase's one_time_tokens design and replaces the dual-use of
-- password_reset_tokens.
--
-- The original password_reset_tokens table is left in place but no
-- longer written to; rows are allowed to expire (1h TTL).

CREATE TABLE IF NOT EXISTS one_time_tokens (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),

    -- Project and user identification
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT,
    email TEXT NOT NULL,

    -- SHA-256 hash of the token (for link-based flows) or hashed OTP code
    token_hash TEXT NOT NULL,

    -- Which flow this token belongs to
    token_type TEXT NOT NULL CHECK (token_type IN (
        'confirmation',
        'recovery',
        'magic_link',
        'email_change',
        'otp',
        'invite'
    )),

    -- Optional per-flow payload (e.g. the new email for email_change,
    -- the OTP code length, or the invitee role for invites)
    payload TEXT,

    -- Token lifecycle (Unix timestamps in seconds)
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s', 'now') as int)),

    -- OTP attempt counter (incremented on each verify; 0 for link flows)
    attempts INTEGER NOT NULL DEFAULT 0,

    UNIQUE(project_id, user_id, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_one_time_tokens_hash
    ON one_time_tokens(token_hash)
    WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_one_time_tokens_project_email_type
    ON one_time_tokens(project_id, email, token_type)
    WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_one_time_tokens_expires
    ON one_time_tokens(expires_at)
    WHERE used_at IS NULL;

-- ============================================================
-- EMAIL TEMPLATES: extend CHECK with 'invite'
-- ============================================================
-- SQLite doesn't support modifying a CHECK constraint in place, so
-- we recreate the table with the new constraint and copy the data
-- across. The unique indexes (one per scope) are recreated.

CREATE TABLE IF NOT EXISTS email_templates__new (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN (
        'welcome', 'confirmation', 'password_reset',
        'magic_link', 'email_change', 'otp', 'invite'
    )),
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO email_templates__new
    (id, project_id, type, subject, body_html, body_text, created_at, updated_at)
SELECT id, project_id, type, subject, body_html, body_text, created_at, updated_at
FROM email_templates;

DROP TABLE email_templates;
ALTER TABLE email_templates__new RENAME TO email_templates;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_project_type
    ON email_templates(project_id, type) WHERE project_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_system_type
    ON email_templates(type) WHERE project_id IS NULL;

-- Default invite system template (the only new template we add)
INSERT OR IGNORE INTO email_templates (project_id, type, subject, body_html, body_text) VALUES
(NULL, 'invite',
  'You''ve been invited to {{app_name}}',
  '<h1>You''re invited</h1><p>{{app_name}} invited you to join. Click the link to accept: <a href="{{action_url}}">Accept invitation</a></p>',
  'You''re invited to {{app_name}}. Accept the invitation: {{action_url}}'
);
