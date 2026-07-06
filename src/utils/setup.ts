import { Env } from '../types';

export const INITIAL_SCHEMA = `
-- Migration: Initial Schema (Merged)
-- Created: 2025-02-19
-- Description: Consolidated schema for Cloudflare Auth Service

-- ============================================================
-- PROJECTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT UNIQUE NOT NULL,
    description TEXT,

    -- Project configuration
    environment TEXT NOT NULL DEFAULT 'production'
        CHECK (environment IN ('development', 'staging', 'production')),

    -- JWT configuration for this project
    jwt_secret TEXT NOT NULL,
    jwt_algorithm TEXT DEFAULT 'HS256',
    jwt_expiry_seconds INTEGER DEFAULT 3600,
    refresh_token_expiry_seconds INTEGER DEFAULT 604800,

    -- Project status
    enabled INTEGER DEFAULT 1,

    -- User table reference (dynamic)
    user_table_name TEXT NOT NULL,

    -- Site URL configuration
    site_url TEXT,
    redirect_urls TEXT, -- JSON array string

    -- Timestamps
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_projects_name ON projects(name);
CREATE INDEX IF NOT EXISTS idx_projects_environment ON projects(environment);
CREATE INDEX IF NOT EXISTS idx_projects_enabled ON projects(enabled) WHERE enabled = 1;
CREATE INDEX IF NOT EXISTS idx_projects_user_table_name ON projects(user_table_name);
CREATE INDEX IF NOT EXISTS idx_projects_site_url ON projects(site_url) WHERE site_url IS NOT NULL;

-- ============================================================
-- USER TABLE METADATA
-- ============================================================

CREATE TABLE IF NOT EXISTS _user_table_metadata (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    table_name TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(project_id)
);

CREATE INDEX IF NOT EXISTS idx_user_table_metadata_project_id ON _user_table_metadata(project_id);
CREATE INDEX IF NOT EXISTS idx_user_table_metadata_table_name ON _user_table_metadata(table_name);

-- ============================================================
-- OAUTH PROVIDERS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS project_oauth_providers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Provider configuration
    provider_name TEXT NOT NULL CHECK (provider_name IN ('google', 'github', 'microsoft', 'apple', 'custom')),
    enabled INTEGER DEFAULT 1,

    -- OAuth credentials
    client_id TEXT NOT NULL,
    client_secret TEXT NOT NULL,

    -- OAuth URLs
    authorization_url TEXT,
    token_url TEXT,
    user_info_url TEXT,

    -- Scopes and configuration
    scopes TEXT,
    additional_config TEXT,

    -- Timestamps
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(project_id, provider_name)
);

CREATE INDEX IF NOT EXISTS idx_oauth_providers_project_id ON project_oauth_providers(project_id);
CREATE INDEX IF NOT EXISTS idx_oauth_providers_enabled ON project_oauth_providers(project_id, enabled)
    WHERE enabled = 1;

-- ============================================================
-- REFRESH TOKENS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,

    -- Token data
    token_hash TEXT UNIQUE NOT NULL,

    -- Token metadata
    device_name TEXT,
    user_agent TEXT,
    ip_address TEXT,

    -- Expiry and revocation
    expires_at TEXT NOT NULL,
    revoked INTEGER DEFAULT 0,
    revoked_at TEXT,
    revoked_reason TEXT,

    -- Timestamps
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_project_user
    ON refresh_tokens(project_id, user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
    ON refresh_tokens(token_hash) WHERE revoked = 0;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at
    ON refresh_tokens(expires_at) WHERE revoked = 0;

-- ============================================================
-- PASSWORD RESET TOKENS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),

    -- User identification
    user_id TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    email TEXT NOT NULL,

    -- Token data (SHA-256 hash of the actual token sent to user)
    token_hash TEXT NOT NULL,

    -- Token lifecycle
    expires_at INTEGER NOT NULL,  -- Unix timestamp when token expires (typically 1 hour)
    used_at INTEGER,              -- Unix timestamp when token was used (NULL if unused)
    created_at INTEGER NOT NULL,

    -- Ensure one active token per user
    -- Multiple tokens can exist if previous ones are used/expired
    UNIQUE(project_id, user_id, token_hash)
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash
    ON password_reset_tokens(token_hash)
    WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_project_email
    ON password_reset_tokens(project_id, email)
    WHERE used_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires
    ON password_reset_tokens(expires_at)
    WHERE used_at IS NULL;

-- ============================================================
-- AUTH ATTEMPTS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS auth_attempts (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Attempt details
    attempt_type TEXT NOT NULL CHECK (attempt_type IN ('login', 'register', 'password_reset', 'oauth', 'refresh')),
    email TEXT,
    ip_address TEXT NOT NULL,
    user_agent TEXT,

    -- Result
    success INTEGER NOT NULL,
    failure_reason TEXT,

    -- User context (if applicable)
    user_id TEXT,

    -- Timestamp
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_project_ip
    ON auth_attempts(project_id, ip_address, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_email
    ON auth_attempts(project_id, email, created_at) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_auth_attempts_created_at
    ON auth_attempts(created_at);

-- ============================================================
-- RATE LIMIT RULES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS rate_limit_rules (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,

    -- Rule configuration
    rule_type TEXT NOT NULL CHECK (rule_type IN ('per_ip', 'per_email', 'per_project')),
    window_seconds INTEGER NOT NULL DEFAULT 60,
    max_attempts INTEGER NOT NULL DEFAULT 5,

    -- Action on limit exceeded
    action TEXT DEFAULT 'block' CHECK (action IN ('block', 'delay', 'captcha')),
    block_duration_seconds INTEGER DEFAULT 300,

    -- Rule status
    enabled INTEGER DEFAULT 1,

    -- Timestamps
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(project_id, rule_type)
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_rules_project
    ON rate_limit_rules(project_id, enabled) WHERE enabled = 1;

-- ============================================================
-- AUDIT LOGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,

    -- Event details
    event_type TEXT NOT NULL CHECK (event_type IN (
        'user_created', 'user_login', 'user_logout', 'user_deleted',
        'password_changed', 'email_verified', 'oauth_linked', 'oauth_unlinked',
        'admin_action', 'project_created', 'project_updated', 'project_deleted',
        'oauth_provider_added', 'oauth_provider_updated', 'oauth_provider_removed',
        'suspicious_activity', 'rate_limit_triggered', 'account_locked',
        'email_confirmation_requested', 'email_confirmed', 'email_confirmation_failed',
        'password_reset_requested', 'password_reset_completed',
        'supabase_import_started', 'supabase_import_completed',
        'supabase_import_failed', 'supabase_import_batch_failed'
    )),
    event_status TEXT DEFAULT 'success' CHECK (event_status IN ('success', 'failure', 'warning')),

    -- Actors
    user_id TEXT,
    admin_user_id TEXT,

    -- Event context
    ip_address TEXT,
    user_agent TEXT,
    event_data TEXT,

    -- Timestamp
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_project_created
    ON audit_logs(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type
    ON audit_logs(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user
    ON audit_logs(user_id, created_at) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_admin
    ON audit_logs(admin_user_id, created_at) WHERE admin_user_id IS NOT NULL;

-- ============================================================
-- ADMIN USERS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),

    -- Admin identity
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,

    -- Admin profile
    display_name TEXT NOT NULL,

    -- Permissions
    role TEXT DEFAULT 'admin' CHECK (role IN ('super_admin', 'admin', 'viewer')),

    -- Status
    enabled INTEGER DEFAULT 1,

    -- MFA
    mfa_enabled INTEGER DEFAULT 0,
    mfa_secret TEXT,

    -- Timestamps
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_login_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_enabled ON admin_users(enabled) WHERE enabled = 1;

-- ============================================================
-- ADMIN SESSIONS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_sessions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    admin_user_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,

    -- Session data
    session_token_hash TEXT UNIQUE NOT NULL,

    -- Session metadata
    ip_address TEXT,
    user_agent TEXT,

    -- Expiry
    expires_at TEXT NOT NULL,

    -- Timestamps
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_user
    ON admin_sessions(admin_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token
    ON admin_sessions(session_token_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires
    ON admin_sessions(expires_at);

-- ============================================================
-- TRIGGERS FOR AUTO-UPDATE
-- ============================================================

-- Auto-update timestamps on projects
CREATE TRIGGER IF NOT EXISTS update_projects_timestamp
    AFTER UPDATE ON projects
    FOR EACH ROW
BEGIN
    UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Auto-update timestamps on oauth providers
CREATE TRIGGER IF NOT EXISTS update_oauth_providers_timestamp
    AFTER UPDATE ON project_oauth_providers
    FOR EACH ROW
BEGIN
    UPDATE project_oauth_providers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Auto-update timestamps on rate limit rules
CREATE TRIGGER IF NOT EXISTS update_rate_limit_rules_timestamp
    AFTER UPDATE ON rate_limit_rules
    FOR EACH ROW
BEGIN
    UPDATE rate_limit_rules SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- Auto-update timestamps on admin users
CREATE TRIGGER IF NOT EXISTS update_admin_users_timestamp
    AFTER UPDATE ON admin_users
    FOR EACH ROW
BEGIN
    UPDATE admin_users SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

-- ============================================================
-- SEED DATA
-- ============================================================

-- Default Admin User (Password: admin123)
INSERT OR IGNORE INTO admin_users (email, password_hash, display_name, role, enabled)
VALUES ('admin@example.com', '$2a$10$9l9XZkcXRcPh6RFjivEhoepD10a7HTeUUqZArN.lh1NZmUQfap6/q', 'Admin User', 'super_admin', 1);

-- ============================================================
-- SYSTEM SETTINGS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL, -- JSON string for complex values
    description TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Insert default settings
INSERT OR IGNORE INTO system_settings (key, value, description) VALUES
('theme', '"system"', 'System theme preference (system, light, dark)'),
('keep_logs', 'true', 'Whether to retain audit logs');

-- ============================================================
-- EMAIL PROVIDERS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS email_providers (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL UNIQUE, -- Display name e.g. "My Postmark"
    provider TEXT NOT NULL, -- 'sendgrid', 'postmark', 'mailgun', 'brevo', 'mailersend', 'mailchimp', 'mailjet', 'smtp2go', 'mailtrap', 'resend', 'smtp', 'custom'
    type TEXT NOT NULL CHECK (type IN ('api', 'smtp')),
    is_default INTEGER DEFAULT 0,
    is_fallback INTEGER DEFAULT 0,
    config TEXT NOT NULL, -- Encrypted JSON string with api_key, domain, etc.
    from_email TEXT NOT NULL,
    from_name TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Trigger to ensure only one default provider
CREATE TRIGGER IF NOT EXISTS ensure_single_default_provider
AFTER UPDATE OF is_default ON email_providers
FOR EACH ROW
WHEN NEW.is_default = 1
BEGIN
    UPDATE email_providers SET is_default = 0 WHERE id != NEW.id;
END;

-- Trigger to ensure only one fallback provider
CREATE TRIGGER IF NOT EXISTS ensure_single_fallback_provider
AFTER UPDATE OF is_fallback ON email_providers
FOR EACH ROW
WHEN NEW.is_fallback = 1
BEGIN
    UPDATE email_providers SET is_fallback = 0 WHERE id != NEW.id;
END;

-- ============================================================
-- EMAIL TEMPLATES TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE, -- NULL for system-wide
    type TEXT NOT NULL CHECK (type IN ('welcome', 'confirmation', 'password_reset', 'magic_link', 'email_change', 'otp', 'invite')),
    subject TEXT NOT NULL,
    body_html TEXT NOT NULL,
    body_text TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Ensure unique template type per project
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_project_type
ON email_templates(project_id, type) WHERE project_id IS NOT NULL;

-- Ensure unique template type for system (NULL project_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_email_templates_system_type
ON email_templates(type) WHERE project_id IS NULL;

-- Insert default system templates
INSERT OR IGNORE INTO email_templates (type, subject, body_html, body_text) VALUES
('welcome', 'Welcome to {{app_name}}!', '<h1>Welcome!</h1><p>Thanks for signing up.</p>', 'Welcome! Thanks for signing up.'),
('confirmation', 'Confirm your email', '<h1>Confirm Email</h1><p>Click <a href="{{action_url}}">here</a> to confirm.</p>', 'Confirm Email: {{action_url}}'),
('password_reset', 'Reset your password', '<h1>Reset Password</h1><p>Click <a href="{{action_url}}">here</a> to reset.</p>', 'Reset Password: {{action_url}}'),
('magic_link', 'Login to {{app_name}}', '<h1>Login</h1><p>Click <a href="{{action_url}}">here</a> to login.</p>', 'Login: {{action_url}}'),
('email_change', 'Verify new email', '<h1>Verify Email</h1><p>Click <a href="{{action_url}}">here</a> to verify.</p>', 'Verify Email: {{action_url}}'),
('otp', 'Your verification code', '<h1>Code: {{otp}}</h1>', 'Your code is: {{otp}}'),
('invite', 'You''re invited to {{app_name}}', '<h1>You''re invited</h1><p>Click <a href="{{action_url}}">here</a> to accept your invitation.</p>', 'You''re invited to {{app_name}}. Accept: {{action_url}}');

-- ============================================================
-- ONE TIME TOKENS TABLE
-- ============================================================

CREATE TABLE IF NOT EXISTS one_time_tokens (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id TEXT,
    email TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    token_type TEXT NOT NULL CHECK (token_type IN (
        'confirmation', 'recovery', 'magic_link', 'email_change', 'otp', 'invite'
    )),
    payload TEXT,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL DEFAULT (cast(strftime('%s', 'now') as int)),
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
`;

export async function initializeDatabase(env: Env): Promise<void> {
  try {
    // Check if the 'projects' table exists as a proxy for database initialization
    // Using a simple query to minimize overhead
    await env.DB.prepare("SELECT 1 FROM projects LIMIT 1").first();
    // If successful, database is already initialized
    return;
  } catch (e: any) {
    // If the error is about the table not existing, we need to initialize
    if (e.message && (e.message.includes("no such table") || e.message.includes("prepare"))) {
      console.log("Database not initialized. Running initial schema migration...");
      try {
        await env.DB.exec(INITIAL_SCHEMA);
        console.log("Database initialized successfully.");
      } catch (migrationError) {
        console.error("Failed to run initial migration:", migrationError);
        throw migrationError;
      }
    } else {
      // Re-throw other errors
      console.error("Error checking database status:", e);
      // Don't throw here to avoid crashing the worker on transient errors,
      // but log it. If the DB is down, subsequent queries will fail anyway.
    }
  }
}
