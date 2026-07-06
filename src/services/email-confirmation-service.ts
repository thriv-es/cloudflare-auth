import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { oneTimeTokens } from '../db/schema';
import { hashToken } from '../utils/crypto';
import { auditService } from './audit-service';
import { userService } from './user-service';
import { projectService } from './project-service';
import type { Env } from '../types';
import { NotFoundError, AuthenticationError } from '../utils/errors';

const TYPE = 'confirmation' as const;
const TTL_SECONDS = 86400; // 24 hours

/**
 * Email Confirmation Service - Handles email confirmation token
 * generation and validation, using the unified `one_time_tokens` table.
 */
export class EmailConfirmationService {
  async createConfirmationToken(
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
      eventType: 'email_confirmation_requested',
      eventStatus: 'success',
      userId,
      eventData: { email },
    });

    return { token, tokenId };
  }

  async validateConfirmationToken(
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
      throw new AuthenticationError('Invalid confirmation token');
    }
    if (tokenRecord.usedAt !== null) {
      throw new AuthenticationError('Confirmation token has already been used');
    }
    const now = Math.floor(Date.now() / 1000);
    if (now > tokenRecord.expiresAt) {
      throw new AuthenticationError('Confirmation token has expired');
    }

    return {
      userId: tokenRecord.userId as string,
      email: tokenRecord.email,
      tokenId: tokenRecord.id,
    };
  }

  async useConfirmationToken(env: Env, tokenId: string): Promise<void> {
    const db = drizzle(env.DB);
    const now = Math.floor(Date.now() / 1000);
    await db
      .update(oneTimeTokens)
      .set({ usedAt: now })
      .where(eq(oneTimeTokens.id, tokenId));
  }

  async confirmEmail(
    env: Env,
    projectId: string,
    token: string
  ): Promise<{ userId: string; email: string }> {
    const { userId, email, tokenId } = await this.validateConfirmationToken(
      env, projectId, token
    );

    const project = await projectService.getProject(env, projectId);
    if (!project) throw new NotFoundError('Project not found');

    await userService.updateUser(env, project.userTableName, userId, {
      emailVerified: true,
    });

    await this.useConfirmationToken(env, tokenId);

    await auditService.logEvent(env, {
      projectId,
      eventType: 'email_confirmed',
      eventStatus: 'success',
      userId,
      eventData: { email },
    });

    return { userId, email };
  }
}

export const emailConfirmationService = new EmailConfirmationService();
