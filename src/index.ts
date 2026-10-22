import { Hono } from 'hono';
import type { Env, Variables } from './types';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { authMiddleware } from './middleware/auth';
import { adminAuthMiddleware } from './middleware/admin-auth';

// Services
import { projectService } from './services/project-service';
import { authService } from './services/auth-service';
import { adminAuthService } from './services/admin-auth-service';
import { oauthService } from './services/oauth-service';
import { auditService } from './services/audit-service';
import { userService } from './services/user-service';
import { supabaseImportService } from './services/supabase-import-service';
import { passwordResetService } from './services/password-reset-service';
import { emailService } from './services/email-service';
import { emailConfirmationService } from './services/email-confirmation-service';
import { rateLimitService } from './services/rate-limit-service';
import { SystemSettingsService } from './services/system-settings-service';
import { EmailProviderService } from './services/email-provider-service';
import { EmailTemplateService } from './services/email-template-service';

// Validation
import {
  validate,
  registerSchema,
  loginSchema,
  createProjectSchema,
  adminLoginSchema,
  validateSupabaseCredentialsSchema,
  importFromSupabaseSchema,
  getImportPreviewSchema,
  forgotPasswordSchema,
  resetPasswordSchema
} from './utils/validation';
import { getIpAddress, getUserAgent } from './utils/helpers';
import { initializeDatabase } from './utils/setup';

// Initialize Hono app
const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Global middleware
app.use('*', corsMiddleware);
app.onError(errorHandler);

// Database initialization middleware
let dbInitialized = false;
app.use('*', async (c, next) => {
  if (!dbInitialized) {
    try {
      await initializeDatabase(c.env);
      dbInitialized = true;
    } catch (e) {
      console.error('Failed to initialize database:', e);
      // We don't block the request here, but subsequent DB operations might fail
    }
  }
  await next();
});

// ============================================================
// ROOT HANDLER
// ============================================================
// Redirect root to admin panel
app.get('/', (c) => {
  return c.redirect('/admin/', 302);
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'auth', timestamp: new Date().toISOString() });
});

// ============================================================
// ADMIN UI - Serve static assets from /admin
// ============================================================

app.get('/admin/*', async (c) => {
  if (!c.env.ASSETS) {
    return c.text('Admin UI not configured', 404);
  }

  const url = new URL(c.req.url);
  let path = url.pathname;

  // Remove /admin prefix to get the actual file path in the dist folder
  const assetPath = path.replace(/^\/admin/, '') || '/';

  // Create a new request with the modified path
  const assetRequest = new Request(new URL(assetPath, url.origin), c.req.raw);
  let response = await c.env.ASSETS.fetch(assetRequest);

  // If not found, serve index.html for SPA routing
  if (response.status === 404) {
    const indexRequest = new Request(new URL('/index.html', url.origin), c.req.raw);
    response = await c.env.ASSETS.fetch(indexRequest);
  }

  return response;
});

// Redirect /admin to /admin/
app.get('/admin', (c) => {
  return c.redirect('/admin/');
});

// ============================================================
// ADMIN API ROUTES
// ============================================================

// Admin login
app.post('/api/admin/login', async (c) => {
  const body = await c.req.json();
  const data = validate(adminLoginSchema, body);

  const ipAddress = getIpAddress(c.req.raw);
  const userAgent = getUserAgent(c.req.raw);

  const { sessionToken, admin } = await adminAuthService.adminLogin(
    c.env,
    data.email,
    data.password,
    ipAddress,
    userAgent
  );

  return c.json({
    success: true,
    data: {
      sessionToken,
      admin: {
        id: admin.id,
        email: admin.email,
        displayName: admin.displayName,
        role: admin.role,
      },
      requiresSetup: admin.email === "admin@example.com",
    },
  });
});

// Admin logout
app.post('/api/admin/logout', adminAuthMiddleware, async (c) => {
  const sessionToken = c.req.header('X-Admin-Session') || '';
  await adminAuthService.adminLogout(c.env, sessionToken);

  return c.json({ success: true, message: 'Logged out successfully' });
});

// List projects
app.get('/api/admin/projects', adminAuthMiddleware, async (c) => {
  const environment = c.req.query('environment');
  const enabled = c.req.query('enabled');
  const search = c.req.query('search');

  const projects = await projectService.listProjects(c.env, {
    environment,
    enabled: enabled ? enabled === 'true' : undefined,
    search,
  });

  return c.json({
    success: true,
    data: projects,
    total: projects.length,
  });
});

// Create project
app.post('/api/admin/projects', adminAuthMiddleware, async (c) => {
  const body = await c.req.json();
  const data = validate(createProjectSchema, body);
  const admin = c.get('admin');

  const project = await projectService.createProject(c.env, data, admin.id);

  return c.json({
    success: true,
    data: project,
    message: 'Project created successfully',
  });
});

// Get project
app.get('/api/admin/projects/:id', adminAuthMiddleware, async (c) => {
  const id = c.req.param('id');
  const project = await projectService.getProject(c.env, id);

  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404);
  }

  return c.json({ success: true, data: project });
});

// Update project
app.put('/api/admin/projects/:id', adminAuthMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const admin = c.get('admin');

  const project = await projectService.updateProject(c.env, id, body, admin.id);

  return c.json({
    success: true,
    data: project,
    message: 'Project updated successfully',
  });
});

// Delete project
app.delete('/api/admin/projects/:id', adminAuthMiddleware, async (c) => {
  const id = c.req.param('id');
  const admin = c.get('admin');

  await projectService.deleteProject(c.env, id, admin.id);

  return c.json({
    success: true,
    message: 'Project deleted successfully',
  });
});

// Configure OAuth provider
app.post('/api/admin/projects/:id/oauth', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('id');
  const body = await c.req.json();

  const provider = await oauthService.configureProvider(c.env, {
    projectId,
    ...body,
  });

  return c.json({
    success: true,
    data: provider,
    message: 'OAuth provider configured successfully',
  });
});

// Get audit logs
app.get('/api/admin/audit-logs', adminAuthMiddleware, async (c) => {
  const projectId = c.req.query('projectId');
  const eventType = c.req.query('eventType');
  const limit = parseInt(c.req.query('limit') || '50');

  const logs = await auditService.getAuditLogs(c.env, {
    projectId,
    eventType,
    limit,
  });

  return c.json({
    success: true,
    data: logs,
    total: logs.length,
  });
});

// ============================================================
// ADMIN USERS ROUTES
// ============================================================

// List admin users
app.get('/api/admin/users', adminAuthMiddleware, async (c) => {
  const admins = await adminAuthService.listAdminUsers(c.env);

  return c.json({
    success: true,
    data: admins.map(admin => ({
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role,
      enabled: admin.enabled,
      lastLoginAt: admin.lastLoginAt,
      createdAt: admin.createdAt,
    })),
  });
});

// Create admin user
app.post('/api/admin/users', adminAuthMiddleware, async (c) => {
  const body = await c.req.json();

  const admin = await adminAuthService.createAdminUser(c.env, {
    email: body.email,
    password: body.password,
    displayName: body.displayName,
    role: body.role || 'admin',
  });

  return c.json({
    success: true,
    data: {
      id: admin.id,
      email: admin.email,
      displayName: admin.displayName,
      role: admin.role,
    },
    message: 'Admin user created successfully',
  });
});

// Update admin user
app.put('/api/admin/users/:id', adminAuthMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();

  const admin = await adminAuthService.updateAdminUser(c.env, id, body);

  return c.json({
    success: true,
    data: admin,
    message: 'Admin user updated successfully',
  });
});

// Change admin password
app.post('/api/admin/users/:id/change-password', adminAuthMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const currentAdmin = c.get('admin');

  // Ensure user can only change their own password unless they are super_admin
  // But usually password change requiring current password is a self-service action.
  // If super_admin resets password, they usually don't need current password.
  // The requirement is "existing password" which implies self-service.
  // Let's enforce that id matches currentAdmin.id for now, or allow super_admin to override?
  // The prompt implies the user is editing a user. "when editing a admin user ... change password with existing password".
  // This implies editing ANY user. But usually you don't know other user's password.
  // If I am editing another user, I shouldn't need THEIR existing password to reset it.
  // I should just set a new password.
  // However, the prompt says "existing password", "new password", "retype new password".
  // This specific flow (requiring existing password) is typically for changing YOUR OWN password.
  // If I edit ANOTHER user, I usually just "Set new password".
  // Let's assume this flow is for changing your own password OR the prompt meant "when I edit MY user" or generic "Edit User".
  // But if I edit another user, I can't provide "existing password".
  // So I will implement this endpoint to REQUIRE current password, which implicitly means it works for:
  // 1. Yourself (you know your password)
  // 2. Someone else IF you know their password (unlikely/bad practice)

  // So if the ID is different from currentAdmin.id, and we enforce currentPassword, it's weird.
  // But let's stick to the implementation in service: it checks currentPassword.

  await adminAuthService.changeAdminPassword(c.env, id, body.currentPassword, body.newPassword);

  return c.json({
    success: true,
    message: 'Password changed successfully',
  });
});

// Delete admin user
app.delete('/api/admin/users/:id', adminAuthMiddleware, async (c) => {
  const id = c.req.param('id');
  const currentAdmin = c.get('admin');

  // Prevent self-deletion
  if (id === currentAdmin.id) {
    return c.json({
      success: false,
      error: 'Cannot delete your own account',
    }, 400 as any);
  }

  // For now, we'll disable the admin user instead of deleting
  await adminAuthService.updateAdminUser(c.env, id, { enabled: false });

  return c.json({
    success: true,
    message: 'Admin user disabled successfully',
  });
});

// ============================================================
// PROJECT USERS ROUTES
// ============================================================

// List users in a project
app.get('/api/admin/projects/:projectId/users', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId');
  const limit = parseInt(c.req.query('limit') || '10');
  const offset = parseInt(c.req.query('offset') || '0');
  const search = c.req.query('search');

  const project = await projectService.getProject(c.env, projectId);
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as any);
  }

  const users = await userService.listUsers(c.env, project.userTableName, {
    limit,
    offset,
  });

  // Filter by search if provided
  let filteredUsers = users;
  if (search) {
    const searchLower = search.toLowerCase();
    filteredUsers = users.filter(u =>
      u.email.toLowerCase().includes(searchLower) ||
      u.displayName?.toLowerCase().includes(searchLower)
    );
  }

  const total = await userService.countUsers(c.env, project.userTableName);

  return c.json({
    success: true,
    data: filteredUsers,
    total,
  });
});

// Create user in project
app.post('/api/admin/projects/:projectId/users', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json();

  const project = await projectService.getProject(c.env, projectId);
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as any);
  }

  const user = await userService.createUser(c.env, project.userTableName, {
    email: body.email,
    password: body.password,
    passwordHash: body.password ? await import('./utils/crypto').then(m => m.hashPassword(body.password)) : undefined,
    displayName: body.displayName || `${body.firstName || ''} ${body.lastName || ''}`.trim(),
  });

  return c.json({
    success: true,
    data: user,
    message: 'User created successfully',
  });
});

// Update user in project
app.put('/api/admin/projects/:projectId/users/:userId', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId');
  const userId = c.req.param('userId');
  const body = await c.req.json();

  const project = await projectService.getProject(c.env, projectId);
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as any);
  }

  // Only allow updating specific fields
  const updates: any = {};
  if (body.displayName !== undefined) updates.displayName = body.displayName;
  if (body.email !== undefined) updates.email = body.email;
  if (body.status !== undefined) updates.status = body.status;
  if (body.emailVerified !== undefined) updates.emailVerified = body.emailVerified;
  if (body.password !== undefined && body.password.trim() !== '') {
    // Only update password if provided and not empty
    updates.passwordHash = await import('./utils/crypto').then(m => m.hashPassword(body.password));
  }

  const user = await userService.updateUser(c.env, project.userTableName, userId, updates);

  return c.json({
    success: true,
    data: user,
    message: 'User updated successfully',
  });
});

// Delete user from project
app.delete('/api/admin/projects/:projectId/users/:userId', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId');
  const userId = c.req.param('userId');

  const project = await projectService.getProject(c.env, projectId);
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as any);
  }

  await userService.deleteUser(c.env, project.userTableName, userId);

  return c.json({
    success: true,
    message: 'User deleted successfully',
  });
});

// Resend verification email
app.post('/api/admin/projects/:projectId/users/:userId/resend-verification', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId');
  const userId = c.req.param('userId');

  const ipAddress = getIpAddress(c.req.raw);
  const userAgent = getUserAgent(c.req.raw);

  try {
    // Check rate limiting for email resend
    await rateLimitService.checkRateLimit(c.env, projectId, 'register', ipAddress, userId);

    // Get project
    const project = await projectService.getProject(c.env, projectId);
    if (!project) {
      return c.json({ success: false, error: 'Project not found' }, 404 as any);
    }

    // Get user
    const user = await userService.getUserById(c.env, project.userTableName, userId);
    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404 as any);
    }

    // Check if email is already verified
    if (user.emailVerified) {
      return c.json({ success: false, error: 'Email is already verified' }, 400 as any);
    }

    // Create new confirmation token
    const { token } = await emailConfirmationService.createConfirmationToken(
      c.env,
      projectId,
      userId,
      user.email
    );

    // Generate confirmation URL - prioritize project.siteUrl over env variable
    const baseUrl = project.siteUrl || c.env.EMAIL_CONFIRMATION_BASE_URL;
    if (!baseUrl) {
      throw new Error('No siteUrl configured for project and no EMAIL_CONFIRMATION_BASE_URL env variable set');
    }
    const confirmationUrl = `${baseUrl}/confirm-email?token=${token}`;

    // Send confirmation email
    await emailService.sendConfirmationEmail(
      c.env,
      user.email,
      project.name,
      confirmationUrl,
      projectId
    );

    // Record successful attempt
    await rateLimitService.recordAttempt(
      c.env,
      projectId,
      'register',
      ipAddress,
      userId,
      true,
      userId
    );

    // Log audit event
    await auditService.logEvent(c.env, {
      projectId,
      eventType: 'email_confirmation_requested',
      eventStatus: 'success',
      userId,
      ipAddress,
      userAgent,
      eventData: { email: user.email, action: 'resend' },
    });

    console.log('Verification email resent to:', user.email);

    return c.json({
      success: true,
      message: 'Verification email sent successfully',
    });
  } catch (error: any) {
    // Log audit event for failure
    await auditService.logEvent(c.env, {
      projectId,
      eventType: 'email_confirmation_requested',
      eventStatus: 'failure',
      userId,
      ipAddress,
      userAgent,
      eventData: { action: 'resend', error: error.message },
    });

    throw error;
  }
});

// ============================================================
// SUPABASE IMPORT ROUTES
// ============================================================

// Validate Supabase credentials
app.post('/api/admin/projects/:projectId/import-supabase/validate', adminAuthMiddleware, async (c) => {
  const body = await c.req.json();
  const data = validate(validateSupabaseCredentialsSchema, body);

  const result = await supabaseImportService.validateSupabaseCredentials(
    data.supabaseUrl,
    data.supabaseServiceKey
  );

  return c.json({
    success: result.valid,
    data: result.valid ? { userCount: result.userCount } : undefined,
    error: result.error,
  });
});

// Get import preview
app.post('/api/admin/projects/:projectId/import-supabase/preview', adminAuthMiddleware, async (c) => {
  const body = await c.req.json();
  const data = validate(getImportPreviewSchema, body);

  const preview = await supabaseImportService.getImportPreview(
    data.supabaseUrl,
    data.supabaseServiceKey,
    data.limit
  );

  return c.json({
    success: true,
    data: preview,
  });
});

// Import from Supabase
app.post('/api/admin/projects/:projectId/import-supabase', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const data = validate(importFromSupabaseSchema, body);

  // Get project
  const project = await projectService.getProject(c.env, projectId);
  if (!project) {
    return c.json({ success: false, error: 'Project not found' }, 404 as any);
  }

  // Import users
  const result = await supabaseImportService.importUsers(
    c.env,
    projectId,
    project.userTableName,
    data.supabaseUrl,
    data.supabaseServiceKey,
    data.options || {}
  );

  return c.json({
    success: true,
    data: result,
  });
});

// ============================================================
// OAUTH PROVIDERS ROUTES
// ============================================================

// List OAuth providers for a project
app.get('/api/admin/projects/:projectId/oauth', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId');

  const providers = await oauthService.listProviders(c.env, projectId);

  return c.json({
    success: true,
    data: providers,
  });
});

// Update OAuth provider
app.put('/api/admin/projects/:projectId/oauth/:providerId', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId');
  const providerId = c.req.param('providerId');
  const body = await c.req.json();

  const provider = await oauthService.updateProvider(c.env, providerId, body);

  return c.json({
    success: true,
    data: provider,
    message: 'OAuth provider updated successfully',
  });
});

// Delete OAuth provider
app.delete('/api/admin/projects/:projectId/oauth/:providerId', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId');
  const providerId = c.req.param('providerId');

  await oauthService.deleteProvider(c.env, providerId);

  return c.json({
    success: true,
    message: 'OAuth provider deleted successfully',
  });
});

// ============================================================
// SETTINGS ROUTES
// ============================================================

app.get('/api/admin/settings', adminAuthMiddleware, async (c) => {
  const settingsService = new SystemSettingsService(c.env.DB);
  const settings = await settingsService.getSettings();
  return c.json({ success: true, data: settings });
});

app.put('/api/admin/settings', adminAuthMiddleware, async (c) => {
  const body = await c.req.json();
  const settingsService = new SystemSettingsService(c.env.DB);

  for (const [key, value] of Object.entries(body)) {
    await settingsService.updateSetting(key, value);
  }

  const settings = await settingsService.getSettings();
  return c.json({ success: true, data: settings, message: 'Settings updated' });
});

// ============================================================
// EMAIL PROVIDER ROUTES
// ============================================================

app.get('/api/admin/email-providers', adminAuthMiddleware, async (c) => {
  const providerService = new EmailProviderService(c.env.DB);
  const providers = await providerService.getProviders();
  return c.json({ success: true, data: providers });
});

app.post('/api/admin/email-providers', adminAuthMiddleware, async (c) => {
  const body = await c.req.json();
  const providerService = new EmailProviderService(c.env.DB);

  // Basic validation - should use Zod
  if (!body.name || !body.provider || !body.type || !body.config || !body.fromEmail) {
    return c.json({ success: false, error: 'Missing required fields' }, 400 as any);
  }

  const provider = await providerService.createProvider(body);
  return c.json({ success: true, data: provider, message: 'Email provider created' });
});

app.put('/api/admin/email-providers/:id', adminAuthMiddleware, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const providerService = new EmailProviderService(c.env.DB);

  const provider = await providerService.updateProvider(id, body);
  return c.json({ success: true, data: provider, message: 'Email provider updated' });
});

app.delete('/api/admin/email-providers/:id', adminAuthMiddleware, async (c) => {
  const id = c.req.param('id');
  const providerService = new EmailProviderService(c.env.DB);

  await providerService.deleteProvider(id);
  return c.json({ success: true, message: 'Email provider deleted' });
});

// ============================================================
// EMAIL TEMPLATE ROUTES
// ============================================================

app.get('/api/admin/email-templates', adminAuthMiddleware, async (c) => {
  const templateService = new EmailTemplateService(c.env.DB);
  const templates = await templateService.getSystemTemplates();
  return c.json({ success: true, data: templates });
});

app.get('/api/admin/projects/:projectId/email-templates', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId');
  const templateService = new EmailTemplateService(c.env.DB);
  const templates = await templateService.getProjectTemplates(projectId);
  return c.json({ success: true, data: templates });
});

app.put('/api/admin/email-templates/:type', adminAuthMiddleware, async (c) => {
  const type = c.req.param('type') as any;
  const body = await c.req.json();
  const templateService = new EmailTemplateService(c.env.DB);

  const template = await templateService.createOrUpdateTemplate(null, type, body);
  return c.json({ success: true, data: template, message: 'Template updated' });
});

app.put('/api/admin/projects/:projectId/email-templates/:type', adminAuthMiddleware, async (c) => {
  const projectId = c.req.param('projectId');
  const type = c.req.param('type') as any;
  const body = await c.req.json();
  const templateService = new EmailTemplateService(c.env.DB);

  const template = await templateService.createOrUpdateTemplate(projectId, type, body);
  return c.json({ success: true, data: template, message: 'Template updated' });
});

app.delete('/api/admin/projects/:projectId/email-templates/:id', adminAuthMiddleware, async (c) => {
  const id = c.req.param('id');
  const templateService = new EmailTemplateService(c.env.DB);

  await templateService.deleteProjectTemplate(id);
  return c.json({ success: true, message: 'Template reset to system default' });
});

// ============================================================
// AUTH ROUTES (Per-Project)
// ============================================================

// Register
app.post('/api/auth/:projectId/register', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const data = validate(registerSchema, body);

  const result = await authService.register(c.env, projectId, data, c.req.raw);

  // Send email confirmation (non-blocking - don't fail registration if email fails)
  try {
    // Get project for name
    const project = await projectService.getProject(c.env, projectId);

    if (project) {
        // Create confirmation token
        const { token } = await emailConfirmationService.createConfirmationToken(
          c.env,
          projectId,
          result.user.id,
          result.user.email
        );

        // Generate confirmation URL - prioritize project.siteUrl over env variable
        const baseUrl = project.siteUrl || c.env.EMAIL_CONFIRMATION_BASE_URL;
        if (!baseUrl) {
          throw new Error('No siteUrl configured for project and no EMAIL_CONFIRMATION_BASE_URL env variable set');
        }
        const confirmationUrl = `${baseUrl}/confirm-email?token=${token}`;

        // Send confirmation email
        await emailService.sendConfirmationEmail(
          c.env,
          result.user.email,
          project.name,
          confirmationUrl,
          projectId
        );

        // Log which URL source is being used
        console.log('Email confirmation URL source:', project.siteUrl ? 'project.siteUrl' : 'EMAIL_CONFIRMATION_BASE_URL');
        console.log('Email confirmation sent to:', result.user.email);
      }
    } catch (emailError: any) {
      // Log error but don't block registration
      console.error('Failed to send confirmation email:', emailError.message);

      // Log audit event for email failure
      await auditService.logEvent(c.env, {
        projectId,
        eventType: 'email_confirmation_failed',
        eventStatus: 'warning',
        userId: result.user.id,
        eventData: {
          email: result.user.email,
          error: emailError.message
        },
      });
    }

  return c.json({
    success: true,
    data: {
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
      },
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
  });
});

// Login
app.post('/api/auth/:projectId/login', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const data = validate(loginSchema, body);

  const result = await authService.login(c.env, projectId, data, c.req.raw);

  return c.json({
    success: true,
    data: {
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
      },
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
  });
});

// Get current user
app.get('/api/auth/:projectId/me', authMiddleware, async (c) => {
  const user = c.get('user');

  return c.json({
    success: true,
    data: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: user.emailVerified,
      status: user.status,
      createdAt: user.createdAt,
    },
  });
});

// Refresh token
app.post('/api/auth/:projectId/refresh', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json();

  const result = await authService.refreshToken(c.env, projectId, body.refreshToken);

  return c.json({
    success: true,
    data: {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
  });
});

// Logout
app.post('/api/auth/:projectId/logout', async (c) => {
  const body = await c.req.json();

  await authService.logout(c.env, body.refreshToken);

  return c.json({
    success: true,
    message: 'Logged out successfully',
  });
});

// Forgot password
app.post('/api/auth/:projectId/forgot-password', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const data = validate(forgotPasswordSchema, body);

  const ipAddress = getIpAddress(c.req.raw);
  const userAgent = getUserAgent(c.req.raw);

  try {
    // Check rate limiting for password reset requests
    await rateLimitService.checkRateLimit(c.env, projectId, 'password_reset', ipAddress, data.email);

    // Get project
    const project = await projectService.getProject(c.env, projectId);
    if (!project) {
      // Don't reveal if project exists for security
      return c.json({
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent',
      });
    }

    // Look up user by email
    const user = await userService.getUserByEmail(c.env, project.userTableName, data.email);

    if (user) {
      // Create reset token
      const { token } = await passwordResetService.createResetToken(
        c.env,
        projectId,
        user.id,
        user.email
      );

      // Generate reset URL - prioritize project.siteUrl over env variable
      const baseUrl = project.siteUrl || c.env.PASSWORD_RESET_BASE_URL;
      if (!baseUrl) {
        throw new Error('No siteUrl configured for project and no PASSWORD_RESET_BASE_URL env variable set');
      }
      const resetUrl = `${baseUrl}/reset-password?token=${token}`;

      // Send password reset email
      await emailService.sendPasswordResetEmail(c.env, user.email, resetUrl, project.name, projectId);

      // Log which URL source is being used
      console.log('Password reset URL source:', project.siteUrl ? 'project.siteUrl' : 'PASSWORD_RESET_BASE_URL');

      // Log audit event
      await auditService.logEvent(c.env, {
        projectId,
        eventType: 'password_reset_requested',
        eventStatus: 'success',
        userId: user.id,
        ipAddress,
        userAgent,
        eventData: { email: user.email },
      });
    }

    // Record the attempt
    await rateLimitService.recordAttempt(
      c.env,
      projectId,
      'password_reset',
      ipAddress,
      data.email,
      true,
      user?.id
    );

    // Always return success to prevent email enumeration
    return c.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent',
    });
  } catch (error: any) {
    // Log audit event for failure
    await auditService.logEvent(c.env, {
      projectId,
      eventType: 'password_reset_requested',
      eventStatus: 'failure',
      ipAddress,
      userAgent,
      eventData: { email: data.email, error: error.message },
    });

    throw error;
  }
});

// Reset password
app.post('/api/auth/:projectId/reset-password', async (c) => {
  const projectId = c.req.param('projectId');
  const body = await c.req.json();
  const data = validate(resetPasswordSchema, body);

  const ipAddress = getIpAddress(c.req.raw);
  const userAgent = getUserAgent(c.req.raw);

  try {
    // Reset password using the token
    await passwordResetService.resetPassword(
      c.env,
      projectId,
      data.token,
      data.newPassword
    );

    // Log audit event
    await auditService.logEvent(c.env, {
      projectId,
      eventType: 'password_reset_completed',
      eventStatus: 'success',
      ipAddress,
      userAgent,
    });

    return c.json({
      success: true,
      message: 'Password has been reset successfully',
    });
  } catch (error: any) {
    // Log audit event for failure
    await auditService.logEvent(c.env, {
      projectId,
      eventType: 'password_reset_completed',
      eventStatus: 'failure',
      ipAddress,
      userAgent,
      eventData: { error: error.message },
    });

    throw error;
  }
});

// Confirm email
app.get('/api/auth/:projectId/confirm-email', async (c) => {
  const projectId = c.req.param('projectId');
  const token = c.req.query('token');

  if (!token) {
    return c.json({
      success: false,
      error: 'Confirmation token required'
    }, 400);
  }

  const ipAddress = getIpAddress(c.req.raw);
  const userAgent = getUserAgent(c.req.raw);

  try {
    // Confirm email using the token
    const { userId, email } = await emailConfirmationService.confirmEmail(
      c.env,
      projectId,
      token
    );

    // Get project for welcome email
    const project = await projectService.getProject(c.env, projectId);

    if (project) {
      try {
        await emailService.sendWelcomeEmail(
          c.env,
          email,
          project.name,
          undefined,
          projectId
        );

        console.log('Welcome email sent to:', email);
      } catch (emailError: any) {
        console.error('Failed to send welcome email:', emailError.message);
      }
    }

    // Log audit event
    await auditService.logEvent(c.env, {
      projectId,
      eventType: 'email_confirmed',
      eventStatus: 'success',
      userId,
      ipAddress,
      userAgent,
      eventData: { email },
    });

    return c.json({
      success: true,
      message: 'Email confirmed successfully',
      data: { email },
    });
  } catch (error: any) {
    // Log audit event for failure
    await auditService.logEvent(c.env, {
      projectId,
      eventType: 'email_confirmed',
      eventStatus: 'failure',
      ipAddress,
      userAgent,
      eventData: { error: error.message },
    });

    throw error;
  }
});

// ============================================================
// OAUTH ROUTES
// ============================================================

// Get OAuth authorization URL
app.get('/api/auth/:projectId/oauth/:provider', async (c) => {
  const projectId = c.req.param('projectId');
  const provider = c.req.param('provider');
  const redirectUri = c.req.query('redirect_uri') || '';
  const state = c.req.query('state') || crypto.randomUUID();

  const authUrl = await oauthService.getAuthUrl(c.env, projectId, provider, redirectUri, state);

  return c.json({
    success: true,
    data: { authUrl, state },
  });
});

// OAuth callback
app.get('/api/auth/:projectId/oauth/:provider/callback', async (c) => {
  const projectId = c.req.param('projectId');
  const provider = c.req.param('provider');
  const code = c.req.query('code');
  const redirectUri = c.req.query('redirect_uri') || '';

  if (!code) {
    return c.json({ success: false, error: 'Authorization code required' }, 400);
  }

  const result = await oauthService.handleCallback(c.env, projectId, provider, code, redirectUri);

  return c.json({
    success: true,
    data: {
      user: {
        id: result.user.id,
        email: result.user.email,
        displayName: result.user.displayName,
      },
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
  });
});

// ============================================================
// EXPORT
// ============================================================

export default app;