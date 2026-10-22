import { drizzle } from 'drizzle-orm/d1';
import { eq, and, lt, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { passwordResetTokens } from '../db/schema';
import { hashToken, hashPassword } from '../utils/crypto';
import { sanitizeTableName } from '../utils/helpers';
import { auditService } from './audit-service';
import { userService } from './user-service';
import { projectService } from './project-service';
import type { Env } from '../types';
import { NotFoundError, AuthenticationError, ValidationError } from '../utils/errors';

/**
 * Password Reset Service - Handles password reset token generation and validation
 */
export class PasswordResetService {
  /**
   * Create a password reset token
   *
   * Generates a secure random token, hashes it with SHA-256, and stores it in the database
   * with a 1-hour expiration time. Returns the plaintext token to be sent via email.
   *
   * @param env - Environment bindings
   * @param projectId - Project ID
   * @param userId - User ID
   * @param email - User email address
   * @returns Object containing the plaintext token and token ID
   *
   * @example
   * ```typescript
   * const { token, tokenId } = await passwordResetService.createResetToken(
   *   env,
   *   'project-123',
   *   'user-456',
   *   'user@example.com'
   * );
   * // Send token via email: https://app.com/reset-password?token=${token}
   * ```
   */
  async createResetToken(
    env: Env,
    projectId: string,
    userId: string,
    email: string
  ): Promise<{ token: string; tokenId: string }> {
    const db = drizzle(env.DB);

    // Verify project exists
    const project = await projectService.getProject(env, projectId);
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Verify user exists
    const user = await userService.getUserById(env, project.userTableName, userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Generate secure random token (32 characters, URL-safe)
    const token = nanoid(32);

    // Hash token for storage
    const tokenHash = await hashToken(token);

    // Calculate expiry time (1 hour from now, in Unix seconds)
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 3600; // 1 hour

    // Store the hashed token
    const result = await db.insert(passwordResetTokens).values({
      projectId,
      userId,
      email,
      tokenHash,
      expiresAt,
      createdAt: now,
      usedAt: null,
    }).returning({ id: passwordResetTokens.id });

    const tokenId = result[0].id;

    // Log audit event
    await auditService.logEvent(env, {
      projectId,
      eventType: 'password_reset_requested',
      eventStatus: 'success',
      userId,
      eventData: { email },
    });

    return { token, tokenId };
  }

  /**
   * Validate a password reset token
   *
   * Verifies that the token exists, hasn't expired, hasn't been used, and belongs to the
   * correct project. Returns user information if valid.
   *
   * @param env - Environment bindings
   * @param projectId - Project ID
   * @param token - Plaintext reset token
   * @returns Object containing user info (userId, email)
   * @throws {AuthenticationError} If token is invalid, expired, or used
   * @throws {NotFoundError} If project not found
   *
   * @example
   * ```typescript
   * const { userId, email } = await passwordResetService.validateResetToken(
   *   env,
   *   'project-123',
   *   'token-from-email'
   * );
   * ```
   */
  async validateResetToken(
    env: Env,
    projectId: string,
    token: string
  ): Promise<{ userId: string; email: string; tokenId: string }> {
    const db = drizzle(env.DB);

    // Hash the provided token
    const tokenHash = await hashToken(token);

    // Look up the token
    const tokenRecord = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.projectId, projectId),
          eq(passwordResetTokens.tokenHash, tokenHash)
        )
      )
      .get();

    if (!tokenRecord) {
      throw new AuthenticationError('Invalid reset token');
    }

    // Check if token has been used
    if (tokenRecord.usedAt !== null) {
      throw new AuthenticationError('Reset token has already been used');
    }

    // Check if token has expired
    const now = Math.floor(Date.now() / 1000);
    if (now > tokenRecord.expiresAt) {
      throw new AuthenticationError('Reset token has expired');
    }

    return {
      userId: tokenRecord.userId,
      email: tokenRecord.email,
      tokenId: tokenRecord.id,
    };
  }

  /**
   * Mark a reset token as used
   *
   * Sets the usedAt timestamp to prevent token reuse.
   *
   * @param env - Environment bindings
   * @param tokenId - Token ID
   *
   * @example
   * ```typescript
   * await passwordResetService.useResetToken(env, 'token-id-123');
   * ```
   */
  async useResetToken(env: Env, tokenId: string): Promise<void> {
    const db = drizzle(env.DB);

    const now = Math.floor(Date.now() / 1000);

    await db
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(eq(passwordResetTokens.id, tokenId));
  }

  /**
   * Reset user password using a valid token
   *
   * Validates the token, hashes the new password with bcrypt, updates the user's password
   * in the per-project user table, marks the token as used, and logs the action.
   * Uses a transaction to ensure data consistency.
   *
   * @param env - Environment bindings
   * @param projectId - Project ID
   * @param token - Plaintext reset token
   * @param newPassword - New password (plaintext)
   * @throws {AuthenticationError} If token is invalid
   * @throws {ValidationError} If password is invalid
   * @throws {NotFoundError} If project or user not found
   *
   * @example
   * ```typescript
   * await passwordResetService.resetPassword(
   *   env,
   *   'project-123',
   *   'reset-token-from-email',
   *   'NewSecurePassword123!'
   * );
   * ```
   */
  async resetPassword(
    env: Env,
    projectId: string,
    token: string,
    newPassword: string
  ): Promise<void> {
    // Validate password
    if (!newPassword || newPassword.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    // Validate the token and get user info
    const { userId, email, tokenId } = await this.validateResetToken(env, projectId, token);

    // Get project to access user table
    const project = await projectService.getProject(env, projectId);
    if (!project) {
      throw new NotFoundError('Project not found');
    }

    // Hash the new password
    const passwordHash = await hashPassword(newPassword);

    // Update user's password in the per-project user table
    await userService.updateUser(env, project.userTableName, userId, {
      passwordHash,
    });

    // Mark token as used
    await this.useResetToken(env, tokenId);

    // Log audit event.
    // The event type has to be one the audit_logs table accepts: the column
    // carries a CHECK constraint and 'password_reset_confirm' is not on it,
    // so the insert failed and took the whole reset down with it — after the
    // password had already been changed and the token already spent.
    await auditService.logEvent(env, {
      projectId,
      eventType: 'password_changed',
      eventStatus: 'success',
      userId,
      eventData: { email, method: 'reset_token' },
    });
  }

  /**
   * Clean up expired tokens
   *
   * Deletes expired tokens that are older than 24 hours. Useful for maintenance
   * and keeping the database clean.
   *
   * @param env - Environment bindings
   * @param projectId - Project ID
   * @returns Number of tokens deleted
   *
   * @example
   * ```typescript
   * const deleted = await passwordResetService.cleanupExpiredTokens(env, 'project-123');
   * console.log(`Deleted ${deleted} expired tokens`);
   * ```
   */
  async cleanupExpiredTokens(env: Env, projectId: string): Promise<number> {
    const db = drizzle(env.DB);

    // Calculate cutoff time (24 hours ago, in Unix seconds)
    const cutoffTime = Math.floor(Date.now() / 1000) - 86400; // 24 hours

    // Count tokens before deletion
    const tokensToDelete = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.projectId, projectId),
          lt(passwordResetTokens.expiresAt, cutoffTime)
        )
      )
      .all();

    // Delete expired tokens older than 24 hours
    if (tokensToDelete.length > 0) {
      await db
        .delete(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.projectId, projectId),
            lt(passwordResetTokens.expiresAt, cutoffTime)
          )
        );
    }

    return tokensToDelete.length;
  }

  /**
   * Revoke all active reset tokens for a user
   *
   * Marks all unused tokens for a user as used to prevent them from being used.
   * Useful when a password has been successfully reset or when a user's account
   * security is compromised.
   *
   * @param env - Environment bindings
   * @param projectId - Project ID
   * @param userId - User ID
   * @returns Number of tokens revoked
   *
   * @example
   * ```typescript
   * const revoked = await passwordResetService.revokeUserTokens(
   *   env,
   *   'project-123',
   *   'user-456'
   * );
   * ```
   */
  async revokeUserTokens(
    env: Env,
    projectId: string,
    userId: string
  ): Promise<number> {
    const db = drizzle(env.DB);

    const now = Math.floor(Date.now() / 1000);

    // Count tokens before revoking
    const tokensToRevoke = await db
      .select()
      .from(passwordResetTokens)
      .where(
        and(
          eq(passwordResetTokens.projectId, projectId),
          eq(passwordResetTokens.userId, userId),
          isNull(passwordResetTokens.usedAt)
        )
      )
      .all();

    // Mark all unused tokens for this user as used
    if (tokensToRevoke.length > 0) {
      await db
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(passwordResetTokens.projectId, projectId),
            eq(passwordResetTokens.userId, userId),
            isNull(passwordResetTokens.usedAt)
          )
        );
    }

    return tokensToRevoke.length;
  }
}

// Export singleton instance
export const passwordResetService = new PasswordResetService();