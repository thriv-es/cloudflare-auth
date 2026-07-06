// Environment bindings
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  EMAIL?: any; // Cloudflare send_email binding (SendEmail)
  EMAIL_FROM?: string; // Default from address for the binding
  ADMIN_SESSION_SECRET?: string;
  ENCRYPTION_KEY?: string;
  ADMIN_DOMAIN?: string;
  SENDGRID_API_KEY?: string;
  SENDGRID_FROM_EMAIL?: string;
  SENDGRID_TEMPLATE_CONFIRMATION?: string;
  SENDGRID_TEMPLATE_PASSWORD_RESET?: string;
  SENDGRID_TEMPLATE_WELCOME?: string;
  PASSWORD_RESET_BASE_URL?: string;
  EMAIL_CONFIRMATION_BASE_URL?: string;
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
}

export interface SystemSettings {
  theme: 'system' | 'light' | 'dark';
  keep_logs: boolean;
}

export type EmailProviderType =
  | 'sendgrid'
  | 'postmark'
  | 'mailgun'
  | 'brevo'
  | 'mailersend'
  | 'mailchimp'
  | 'mailjet'
  | 'smtp2go'
  | 'mailtrap'
  | 'resend'
  | 'smtp'
  | 'cloudflare'
  | 'cloudflare_binding'
  | 'custom';

export interface EmailProvider {
  id: string;
  name: string;
  provider: EmailProviderType;
  type: 'api' | 'smtp';
  isDefault: boolean;
  isFallback: boolean;
  config: Record<string, any>;
  fromEmail: string;
  fromName?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type EmailTemplateType =
  | 'welcome'
  | 'confirmation'
  | 'password_reset'
  | 'magic_link'
  | 'email_change'
  | 'otp'
  | 'invite';

export interface EmailTemplate {
  id: string;
  projectId: string | null;
  type: EmailTemplateType;
  subject: string;
  bodyHtml: string;
  bodyText: string | null;
  createdAt: string;
  updatedAt: string;
}

// Project types
export interface Project {
  id: string;
  name: string;
  description: string | null;
  environment: 'development' | 'staging' | 'production';
  jwtSecret: string;
  jwtAlgorithm: string;
  jwtExpirySeconds: number;
  refreshTokenExpirySeconds: number;
  enabled: boolean;
  userTableName: string;
  siteUrl: string | null;
  redirectUrls: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

export interface CreateProjectData {
  name: string;
  description?: string;
  environment?: 'development' | 'staging' | 'production';
  jwtExpirySeconds?: number;
  refreshTokenExpirySeconds?: number;
  createdBy?: string;
}

// OAuth Provider types
export interface OAuthProvider {
  id: string;
  projectId: string;
  providerName: 'google' | 'github' | 'microsoft' | 'apple' | 'custom';
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  authorizationUrl: string | null;
  tokenUrl: string | null;
  userInfoUrl: string | null;
  scopes: string | null;
  additionalConfig: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOAuthProviderData {
  projectId: string;
  providerName: 'google' | 'github' | 'microsoft' | 'apple' | 'custom';
  enabled?: boolean;
  clientId: string;
  clientSecret: string;
  authorizationUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  scopes?: string[];
  additionalConfig?: Record<string, any>;
}

// User types (for dynamic user tables)
export interface User {
  id: string;
  email: string;
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  passwordHash: string | null;
  oauthProvider: string | null;
  oauthProviderUserId: string | null;
  oauthRawUserData: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  metadata: string | null;
  status: 'active' | 'suspended' | 'deleted';
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface RegisterData {
  email: string;
  password: string;
  displayName?: string;
}

export interface LoginData {
  email: string;
  password: string;
}

// Admin types
export interface AdminUser {
  id: string;
  email: string;
  passwordHash: string;
  displayName: string;
  role: 'super_admin' | 'admin' | 'viewer';
  enabled: boolean;
  mfaEnabled: boolean;
  mfaSecret: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface AdminSession {
  id: string;
  adminUserId: string;
  sessionTokenHash: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: string;
  createdAt: string;
  lastActivityAt: string;
}

// Token types
export interface RefreshToken {
  id: string;
  projectId: string;
  userId: string;
  tokenHash: string;
  deviceName: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  expiresAt: string;
  revoked: boolean;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface JWTPayload {
  sub: string; // user id
  email: string;
  projectId: string;
  iat: number;
  exp: number;
}

// Auth attempt types
export interface AuthAttempt {
  id: string;
  projectId: string;
  attemptType: 'login' | 'register' | 'password_reset' | 'oauth' | 'refresh';
  email: string | null;
  ipAddress: string;
  userAgent: string | null;
  success: boolean;
  failureReason: string | null;
  userId: string | null;
  createdAt: string;
}

// Rate limit types
export interface RateLimitRule {
  id: string;
  projectId: string;
  ruleType: 'per_ip' | 'per_email' | 'per_project';
  windowSeconds: number;
  maxAttempts: number;
  action: 'block' | 'delay' | 'captcha';
  blockDurationSeconds: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// Audit log types
export interface AuditLog {
  id: string;
  projectId: string | null;
  eventType: string;
  eventStatus: 'success' | 'failure' | 'warning';
  userId: string | null;
  adminUserId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  eventData: string | null;
  createdAt: string;
}

export interface CreateAuditLogData {
  projectId?: string;
  eventType: string;
  eventStatus?: 'success' | 'failure' | 'warning';
  userId?: string;
  adminUserId?: string;
  ipAddress?: string;
  userAgent?: string;
  eventData?: Record<string, any>;
}

// API Response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T = any> {
  data: T[];
  total: number;
  page: number;
  perPage: number;
}

// Error types
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed') {
    super(401, message, 'AUTH_ERROR');
  }
}

export class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(403, message, 'AUTHZ_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, message, 'NOT_FOUND');
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super(400, message, 'VALIDATION_ERROR');
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded', public retryAfter?: number) {
    super(429, message, 'RATE_LIMIT_ERROR');
  }
}

// Hono context variables
export type Variables = {
  user: User;
  project: Project;
  jwtPayload: JWTPayload;
  admin: AdminUser;
};