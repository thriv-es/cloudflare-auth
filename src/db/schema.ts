import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  index,
  unique,
} from 'drizzle-orm/sqlite-core';

// Helper function for generating UUIDs (used by most tables except projects)
// Projects now use name-based IDs generated in application code
export const generateId = sql`lower(hex(randomblob(16)))`;

// ============================================================
// PROJECTS
// ============================================================

export const projects = sqliteTable('projects', {
  // Project ID is now generated from project name (e.g., "Test Project" → "test_project")
  // This makes IDs human-readable, URL-safe, and easier to work with in API routes
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  description: text('description'),

  // Project configuration
  environment: text('environment', {
    enum: ['development', 'staging', 'production']
  }).notNull().default('production'),

  // JWT configuration
  jwtSecret: text('jwt_secret').notNull(),
  jwtAlgorithm: text('jwt_algorithm').default('HS256'),
  jwtExpirySeconds: integer('jwt_expiry_seconds').default(3600),
  refreshTokenExpirySeconds: integer('refresh_token_expiry_seconds').default(604800),

  // Project status
  enabled: integer('enabled', { mode: 'boolean' }).default(true),

  // User table reference
  userTableName: text('user_table_name').notNull(),

  // Site URL configuration (for email callbacks and redirects)
  // Used for generating email confirmation and password reset links
  siteUrl: text('site_url'),

  // Allowed redirect URLs (stored as JSON array string)
  // Similar to Supabase's redirect URL allowlist for additional security
  redirectUrls: text('redirect_urls'),

  // Timestamps
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  createdBy: text('created_by'),
}, (table) => ({
  nameIdx: index('idx_projects_name').on(table.name),
  environmentIdx: index('idx_projects_environment').on(table.environment),
  enabledIdx: index('idx_projects_enabled').on(table.enabled),
  userTableNameIdx: index('idx_projects_user_table_name').on(table.userTableName),
  siteUrlIdx: index('idx_projects_site_url').on(table.siteUrl),
}));

// ============================================================
// OAUTH PROVIDERS
// ============================================================

export const projectOAuthProviders = sqliteTable('project_oauth_providers', {
  id: text('id').primaryKey().$defaultFn(() => sql`${generateId}`),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),

  // Provider configuration
  providerName: text('provider_name', {
    enum: ['google', 'github', 'microsoft', 'apple', 'custom']
  }).notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),

  // OAuth credentials
  clientId: text('client_id').notNull(),
  clientSecret: text('client_secret').notNull(),

  // OAuth URLs
  authorizationUrl: text('authorization_url'),
  tokenUrl: text('token_url'),
  userInfoUrl: text('user_info_url'),

  // Scopes and configuration
  scopes: text('scopes'), // JSON array as string
  additionalConfig: text('additional_config'), // JSON for provider-specific settings

  // Timestamps
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  projectProviderUnique: unique().on(table.projectId, table.providerName),
  projectIdIdx: index('idx_oauth_providers_project_id').on(table.projectId),
  enabledIdx: index('idx_oauth_providers_enabled').on(table.projectId, table.enabled),
}));

// ============================================================
// REFRESH TOKENS
// ============================================================

export const refreshTokens = sqliteTable('refresh_tokens', {
  id: text('id').primaryKey().$defaultFn(() => sql`${generateId}`),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull(),

  // Token data
  tokenHash: text('token_hash').notNull().unique(),

  // Token metadata
  deviceName: text('device_name'),
  userAgent: text('user_agent'),
  ipAddress: text('ip_address'),

  // Expiry and revocation
  expiresAt: text('expires_at').notNull(),
  revoked: integer('revoked', { mode: 'boolean' }).default(false),
  revokedAt: text('revoked_at'),
  revokedReason: text('revoked_reason'),

  // Timestamps
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  lastUsedAt: text('last_used_at'),
}, (table) => ({
  projectUserIdx: index('idx_refresh_tokens_project_user').on(table.projectId, table.userId),
  tokenHashIdx: index('idx_refresh_tokens_token_hash').on(table.tokenHash),
  expiresAtIdx: index('idx_refresh_tokens_expires_at').on(table.expiresAt),
}));

// ============================================================
// AUTH ATTEMPTS & RATE LIMITING
// ============================================================

export const authAttempts = sqliteTable('auth_attempts', {
  id: text('id').primaryKey().$defaultFn(() => sql`${generateId}`),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),

  // Attempt details
  attemptType: text('attempt_type', {
    enum: ['login', 'register', 'password_reset', 'oauth', 'refresh']
  }).notNull(),
  email: text('email'),
  ipAddress: text('ip_address').notNull(),
  userAgent: text('user_agent'),

  // Result
  success: integer('success', { mode: 'boolean' }).notNull(),
  failureReason: text('failure_reason'),

  // User context
  userId: text('user_id'),

  // Timestamp
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  projectIpIdx: index('idx_auth_attempts_project_ip').on(table.projectId, table.ipAddress, table.createdAt),
  emailIdx: index('idx_auth_attempts_email').on(table.projectId, table.email, table.createdAt),
  createdAtIdx: index('idx_auth_attempts_created_at').on(table.createdAt),
}));

export const rateLimitRules = sqliteTable('rate_limit_rules', {
  id: text('id').primaryKey().$defaultFn(() => sql`${generateId}`),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),

  // Rule configuration
  ruleType: text('rule_type', {
    enum: ['per_ip', 'per_email', 'per_project']
  }).notNull(),
  windowSeconds: integer('window_seconds').notNull().default(60),
  maxAttempts: integer('max_attempts').notNull().default(5),

  // Action on limit exceeded
  action: text('action', {
    enum: ['block', 'delay', 'captcha']
  }).default('block'),
  blockDurationSeconds: integer('block_duration_seconds').default(300),

  // Rule status
  enabled: integer('enabled', { mode: 'boolean' }).default(true),

  // Timestamps
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  projectRuleUnique: unique().on(table.projectId, table.ruleType),
  projectIdx: index('idx_rate_limit_rules_project').on(table.projectId, table.enabled),
}));

// ============================================================
// AUDIT LOGS
// ============================================================

export const auditLogs = sqliteTable('audit_logs', {
  id: text('id').primaryKey().$defaultFn(() => sql`${generateId}`),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),

  // Event details
  eventType: text('event_type').notNull(),
  eventStatus: text('event_status', {
    enum: ['success', 'failure', 'warning']
  }).default('success'),

  // Actors
  userId: text('user_id'),
  adminUserId: text('admin_user_id'),

  // Event context
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  eventData: text('event_data'), // JSON string

  // Timestamp
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  projectCreatedIdx: index('idx_audit_logs_project_created').on(table.projectId, table.createdAt),
  eventTypeIdx: index('idx_audit_logs_event_type').on(table.eventType, table.createdAt),
  userIdx: index('idx_audit_logs_user').on(table.userId, table.createdAt),
  adminIdx: index('idx_audit_logs_admin').on(table.adminUserId, table.createdAt),
}));

// ============================================================
// ADMIN USERS
// ============================================================

export const adminUsers = sqliteTable('admin_users', {
  id: text('id').primaryKey().$defaultFn(() => sql`${generateId}`),

  // Admin identity
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),

  // Admin profile
  displayName: text('display_name').notNull(),

  // Permissions
  role: text('role', {
    enum: ['super_admin', 'admin', 'viewer']
  }).default('admin'),

  // Status
  enabled: integer('enabled', { mode: 'boolean' }).default(true),

  // MFA
  mfaEnabled: integer('mfa_enabled', { mode: 'boolean' }).default(false),
  mfaSecret: text('mfa_secret'),

  // Timestamps
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
  lastLoginAt: text('last_login_at'),
}, (table) => ({
  emailIdx: index('idx_admin_users_email').on(table.email),
  enabledIdx: index('idx_admin_users_enabled').on(table.enabled),
}));

export const adminSessions = sqliteTable('admin_sessions', {
  id: text('id').primaryKey().$defaultFn(() => sql`${generateId}`),
  adminUserId: text('admin_user_id').notNull().references(() => adminUsers.id, { onDelete: 'cascade' }),

  // Session data
  sessionTokenHash: text('session_token_hash').notNull().unique(),

  // Session metadata
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),

  // Expiry
  expiresAt: text('expires_at').notNull(),

  // Timestamps
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
  lastActivityAt: text('last_activity_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  adminUserIdx: index('idx_admin_sessions_admin_user').on(table.adminUserId),
  tokenIdx: index('idx_admin_sessions_token').on(table.sessionTokenHash, table.expiresAt),
  expiresIdx: index('idx_admin_sessions_expires').on(table.expiresAt),
}));

// ============================================================
// PASSWORD RESET TOKENS
// ============================================================

export const passwordResetTokens = sqliteTable('password_reset_tokens', {
  id: text('id').primaryKey().$defaultFn(() => sql`${generateId}`),

  // User identification
  userId: text('user_id').notNull(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),

  // Token data (SHA-256 hash of the actual token sent to user)
  tokenHash: text('token_hash').notNull(),

  // Token lifecycle (Unix timestamps in seconds)
  expiresAt: integer('expires_at').notNull(), // When token expires (typically now + 3600)
  usedAt: integer('used_at'),                  // When token was used (NULL if unused)
  createdAt: integer('created_at').notNull().$defaultFn(() => sql`cast(strftime('%s', 'now') as int)`),
}, (table) => ({
  // Unique constraint to prevent duplicate tokens for same user
  projectUserTokenUnique: unique().on(table.projectId, table.userId, table.tokenHash),

  // Index for token verification (most common operation)
  tokenHashIdx: index('idx_password_reset_tokens_hash').on(table.tokenHash),

  // Index for finding user's active tokens
  projectEmailIdx: index('idx_password_reset_tokens_project_email').on(table.projectId, table.email),

  // Index for cleanup queries (removing expired tokens)
  expiresIdx: index('idx_password_reset_tokens_expires').on(table.expiresAt),
}));

// ============================================================
// ONE TIME TOKENS
// ============================================================
// Unified token table for all link- and code-based auth flows:
// confirmation, recovery (password reset), magic_link, email_change,
// otp, and invite. Each row carries a `tokenType` discriminator so
// flows cannot accept each other's tokens.

export const oneTimeTokens = sqliteTable('one_time_tokens', {
  id: text('id').primaryKey().$defaultFn(() => sql`${generateId}`),

  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  email: text('email').notNull(),

  tokenHash: text('token_hash').notNull(),
  tokenType: text('token_type', {
    enum: ['confirmation', 'recovery', 'magic_link', 'email_change', 'otp', 'invite'],
  }).notNull(),

  payload: text('payload'), // optional per-flow JSON payload

  expiresAt: integer('expires_at').notNull(),
  usedAt: integer('used_at'),
  createdAt: integer('created_at').notNull().$defaultFn(() => sql`cast(strftime('%s', 'now') as int)`),

  attempts: integer('attempts').notNull().default(0),
}, (table) => ({
  projectUserHashUnique: unique().on(table.projectId, table.userId, table.tokenHash),
  tokenHashIdx: index('idx_one_time_tokens_hash').on(table.tokenHash),
  projectEmailTypeIdx: index('idx_one_time_tokens_project_email_type').on(
    table.projectId, table.email, table.tokenType
  ),
  expiresIdx: index('idx_one_time_tokens_expires').on(table.expiresAt),
}));

// ============================================================
// USER TABLE METADATA
// ============================================================
// USER TABLE METADATA
// ============================================================

export const userTableMetadata = sqliteTable('_user_table_metadata', {
  id: text('id').primaryKey().$defaultFn(() => sql`${generateId}`),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  tableName: text('table_name').notNull().unique(),
  createdAt: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
  projectIdIdx: index('idx_user_table_metadata_project_id').on(table.projectId),
  tableNameIdx: index('idx_user_table_metadata_table_name').on(table.tableName),
}));

// ============================================================
// TYPE EXPORTS
// ============================================================

export type Project = typeof projects.$inferSelect;
export type InsertProject = typeof projects.$inferInsert;

export type UserTableMetadata = typeof userTableMetadata.$inferSelect;
export type InsertUserTableMetadata = typeof userTableMetadata.$inferInsert;

export type ProjectOAuthProvider = typeof projectOAuthProviders.$inferSelect;
export type InsertProjectOAuthProvider = typeof projectOAuthProviders.$inferInsert;

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type InsertRefreshToken = typeof refreshTokens.$inferInsert;

export type AuthAttempt = typeof authAttempts.$inferSelect;
export type InsertAuthAttempt = typeof authAttempts.$inferInsert;

export type RateLimitRule = typeof rateLimitRules.$inferSelect;
export type InsertRateLimitRule = typeof rateLimitRules.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = typeof auditLogs.$inferInsert;

export type AdminUser = typeof adminUsers.$inferSelect;
export type InsertAdminUser = typeof adminUsers.$inferInsert;

export type AdminSession = typeof adminSessions.$inferSelect;
export type InsertAdminSession = typeof adminSessions.$inferInsert;

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type InsertPasswordResetToken = typeof passwordResetTokens.$inferInsert;

export type OneTimeToken = typeof oneTimeTokens.$inferSelect;
export type InsertOneTimeToken = typeof oneTimeTokens.$inferInsert;
export type OneTimeTokenType = OneTimeToken['tokenType'];