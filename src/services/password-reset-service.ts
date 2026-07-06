import { drizzle } from 'drizzle-orm/d1';
import { eq, and, lt, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { oneTimeTokens } from '../db/schema';
import { hashToken, hashPassword } from '../utils/crypto';
import { auditService } from './audit-service';
import { userService } from './user-service';
import { projectService } from './project-service';
import type { Env } from '../types';
import { NotFoundError, AuthenticationError, ValidationError } from '../utils/errors';

const TYPE = 'recovery' as const;
const TTL_SECONDS = 3600; // 1 hour

/**
 * Password Reset Service - Issues and consumes `recovery` tokens from
 * the unified `one_time_tokens` table.
 */
export class PasswordResetService {
  async createResetToken(
    env: Env,
    projectId: string,
    userId: string,
    email: string
  ): Promise<{ token: string; tokenId: string }> {
    const db = drizzle(env.DB);

    const project = await projectService.getProject(env, projectId);
    if (!project) throw new NotFoundError('Project not found');

    const user = await userService.getUserById(env, project.userTableName, userId);
    if (!user) throw new NotFoundError('User not found');

    const token = nanoid(32);
    const tokenHash = await hashToken(token);

    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + TTL_SECONDS;

    const result = await db.insert(oneTimeTokens).values({
      projectId,
      userId,
      email,
      tokenHash,
      tokenType: TYPE,
      expiresAt,
      usedAt: null,
      createdAt: now,
      attempts: 0,
    }).returning({ id: oneTimeTokens.id });

    const tokenId = result[0].id;

    await auditService.logEvent(env, {
      projectId,
      eventType: 'password_reset_requested',
      eventStatus: 'success',
      userId,
      eventData: { email },
    });

    return { token, tokenId };
  }

  async validateResetToken(
    env: Env,
    projectId: string,
    token: string
  ): Promise<{ userId: string; email: string; tokenId: string }> {
    const db = drizzle(env.DB);
    const tokenHash = await hashToken(token);

    const tokenRecord = await db
      .select()
      .from(oneTimeTokens)
      .where(
        and(
          eq(oneTimeTokens.projectId, projectId),
          eq(oneTimeTokens.tokenHash, tokenHash),
          eq(oneTimeTokens.tokenType, TYPE)
        )
      )
      .get();

    if (!tokenRecord) {
      throw new AuthenticationError('Invalid reset token');
    }
    if (tokenRecord.usedAt !== null) {
      throw new AuthenticationError('Reset token has already been used');
    }
    const now = Math.floor(Date.now() / 1000);
    if (now > tokenRecord.expiresAt) {
      throw new AuthenticationError('Reset token has expired');
    }

    return {
      userId: tokenRecord.userId as string,
      email: tokenRecord.email,
      tokenId: tokenRecord.id,
    };
  }

  async useResetToken(env: Env, tokenId: string): Promise<void> {
    const db = drizzle(env.DB);
    const now = Math.floor(Date.now() / 1000);
    await db
      .update(oneTimeTokens)
      .set({ usedAt: now })
      .where(eq(oneTimeTokens.id, tokenId));
  }

  async resetPassword(
    env: Env,
    projectId: string,
    token: string,
    newPassword: string
  ): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }

    const { userId, email, tokenId } = await this.validateResetToken(env, projectId, token);

    const project = await projectService.getProject(env, projectId);
    if (!project) throw new NotFoundError('Project not found');

    const passwordHash = await hashPassword(newPassword);

    await userService.updateUser(env, project.userTableName, userId, { passwordHash });

    await this.useResetToken(env, tokenId);

    await auditService.logEvent(env, {
      projectId,
      eventType: 'password_reset_confirm',
      eventStatus: 'success',
      userId,
      eventData: { email, method: 'reset_token' },
    });
  }

  async cleanupExpiredTokens(env: Env, projectId: string): Promise<number> {
    const db = drizzle(env.DB);
    const cutoffTime = Math.floor(Date.now() / 1000) - 86400;

    const tokensToDelete = await db
      .select()
      .from(oneTimeTokens)
      .where(
        and(
          eq(oneTimeTokens.projectId, projectId),
          lt(oneTimeTokens.expiresAt, cutoffTime)
        )
      )
      .all();

    if (tokensToDelete.length > 0) {
      await db
        .delete(oneTimeTokens)
        .where(
          and(
            eq(oneTimeTokens.projectId, projectId),
            lt(oneTimeTokens.expiresAt, cutoffTime)
          )
        );
    }

    return tokensToDelete.length;
  }

  async revokeUserTokens(
    env: Env,
    projectId: string,
    userId: string
  ): Promise<number> {
    const db = drizzle(env.DB);
    const now = Math.floor(Date.now() / 1000);

    const tokensToRevoke = await db
      .select()
      .from(oneTimeTokens)
      .where(
        and(
          eq(oneTimeTokens.projectId, projectId),
          eq(oneTimeTokens.userId, userId),
          isNull(oneTimeTokens.usedAt)
        )
      )
      .all();

    if (tokensToRevoke.length > 0) {
      await db
        .update(oneTimeTokens)
        .set({ usedAt: now })
        .where(
          and(
            eq(oneTimeTokens.projectId, projectId),
            eq(oneTimeTokens.userId, userId),
            isNull(oneTimeTokens.usedAt)
          )
        );
    }

    return tokensToRevoke.length;
  }
}

export const passwordResetService = new PasswordResetService();
