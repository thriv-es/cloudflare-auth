import type { Env, EmailProvider } from '../types';
import { AppError } from '../utils/errors';
import { EmailProviderService } from './email-provider-service';
import { EmailTemplateService } from './email-template-service';
import { ProviderFactory } from './email/providers';

/**
 * SendGrid API response interface
 */
interface SendGridResponse {
  errors?: Array<{
    message: string;
    field?: string;
    help?: string;
  }>;
}

/**
 * Email template data interfaces
 */
interface ConfirmationEmailData {
  project_name: string;
  confirmation_url: string;
  extra_data?: string;
}

interface PasswordResetEmailData {
  reset_url: string;
  project_name: string;
}

interface WelcomeEmailData {
  project_name: string;
  extra_data?: string;
}

/**
 * Email Service - Handles email sending via configured providers
 */
export class EmailService {
  private readonly defaultFromEmail = 'noreply@example.com';

  private buildProviderConfig(provider: EmailProvider, env: Env): Record<string, any> {
    if (provider.provider === 'cloudflare') {
      return {
        accountId: env.CF_ACCOUNT_ID,
        apiToken: env.CF_API_TOKEN,
        ...provider.config,
      };
    }
    return provider.config;
  }

  /**
   * Render a template with data using Mustache-like syntax {{key}}
   */
  private renderTemplate(template: string, data: Record<string, any>): string {
    return template.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
      const trimmedKey = key.trim();
      return data[trimmedKey] !== undefined ? String(data[trimmedKey]) : match;
    });
  }

  /**
   * Send an email using the configured provider
   */
  private async sendEmail(
    env: Env,
    to: string,
    templateType: 'confirmation' | 'passwordReset' | 'welcome',
    templateData: Record<string, any>,
    subject: string,
    projectId?: string
  ): Promise<void> {
    const db = env.DB;
    const providerService = new EmailProviderService(db);
    const templateService = new EmailTemplateService(db);

    // 1. Get Provider
    let provider = await providerService.getDefaultProvider();
    if (!provider) {
      // Check for legacy SendGrid config
      if (env.SENDGRID_API_KEY) {
        // Use legacy SendGrid path
        return this.sendLegacySendGrid(env, to, templateType, templateData, subject);
      }

      // Try fallback provider
      provider = await providerService.getFallbackProvider();
    }

    // Zero-config default: use the Cloudflare send_email binding when no
    // provider rows are configured. The binding is the recommended path
    // because it needs no API keys or account IDs.
    const useBinding = !provider && (env as any).EMAIL;
    if (useBinding) {
      return this.sendWithBinding(env, templateService, to, templateType, templateData, subject, projectId);
    }

    if (!provider) {
      console.error('No email provider configured');
      throw new AppError(500, 'Email service not configured', 'EMAIL_SERVICE_NOT_CONFIGURED');
    }

    // 2. Get Template
    const dbTemplateTypeMap: Record<string, 'confirmation' | 'password_reset' | 'welcome'> = {
      'confirmation': 'confirmation',
      'passwordReset': 'password_reset',
      'welcome': 'welcome'
    };

    const dbType = dbTemplateTypeMap[templateType];
    const template = await this.resolveTemplate(templateService, projectId, dbType);

    const html = this.renderTemplate(template.bodyHtml, templateData);
    const text = template.bodyText ? this.renderTemplate(template.bodyText, templateData) : undefined;
    const renderedSubject = this.renderTemplate(template.subject, templateData);

    const emailProvider = ProviderFactory.create(provider.provider, this.buildProviderConfig(provider, env));
    await emailProvider.send({
      to,
      from: provider.fromEmail,
      fromName: provider.fromName,
      subject: renderedSubject,
      html,
      text,
    });
  }

  /**
   * Resolve a project template or fall back to the system template.
   * Throws EMAIL_TEMPLATE_NOT_FOUND if neither exists.
   */
  private async resolveTemplate(
    templateService: EmailTemplateService,
    projectId: string | undefined,
    dbType: 'confirmation' | 'password_reset' | 'welcome'
  ) {
    let template = await templateService.getTemplate(projectId || null, dbType);
    if (!template && projectId) {
      template = await templateService.getTemplate(null, dbType);
    }
    if (!template) {
      throw new AppError(500, `Email template ${dbType} not found`, 'EMAIL_TEMPLATE_NOT_FOUND');
    }
    return template;
  }

  /**
   * Send an email via the Cloudflare `send_email` binding.
   *
   * Used as the zero-config default when no provider row is configured.
   * The from address comes from the `EMAIL_FROM` setting or falls back
   * to the binding's own default.
   */
  private async sendWithBinding(
    env: Env,
    templateService: EmailTemplateService,
    to: string,
    templateType: 'confirmation' | 'passwordReset' | 'welcome',
    templateData: Record<string, any>,
    _subject: string,
    projectId?: string
  ): Promise<void> {
    const dbTemplateTypeMap: Record<string, 'confirmation' | 'password_reset' | 'welcome'> = {
      'confirmation': 'confirmation',
      'passwordReset': 'password_reset',
      'welcome': 'welcome'
    };
    const dbType = dbTemplateTypeMap[templateType];
    const template = await this.resolveTemplate(templateService, projectId, dbType);

    const html = this.renderTemplate(template.bodyHtml, templateData);
    const text = template.bodyText ? this.renderTemplate(template.bodyText, templateData) : undefined;
    const renderedSubject = this.renderTemplate(template.subject, templateData);

    const fromEmail = (env as any).EMAIL_FROM as string | undefined ?? this.defaultFromEmail;
    const fromName = (templateData.project_name as string) || (templateData.app_name as string) || undefined;

    const provider = ProviderFactory.create('cloudflare_binding', {
      binding: (env as any).EMAIL,
    });

    await provider.send({
      to,
      from: fromEmail,
      fromName,
      subject: renderedSubject,
      html,
      text,
    });
  }

  /**
   * Legacy SendGrid implementation
   */
  private async sendLegacySendGrid(
    env: Env,
    to: string,
    templateType: 'confirmation' | 'passwordReset' | 'welcome',
    templateData: Record<string, any>,
    subject: string
  ): Promise<void> {
    // Get template ID from environment
    let templateId: string | undefined;
    switch (templateType) {
      case 'confirmation':
        templateId = env.SENDGRID_TEMPLATE_CONFIRMATION;
        break;
      case 'passwordReset':
        templateId = env.SENDGRID_TEMPLATE_PASSWORD_RESET;
        break;
      case 'welcome':
        templateId = env.SENDGRID_TEMPLATE_WELCOME;
        break;
    }

    if (!templateId) {
      console.error(`SendGrid template ID for ${templateType} not configured`);
      throw new AppError(
        500,
        `Email template for ${templateType} not configured`,
        'EMAIL_TEMPLATE_NOT_CONFIGURED'
      );
    }

    const fromEmail = env.SENDGRID_FROM_EMAIL || this.defaultFromEmail;

    const payload = {
      personalizations: [
        {
          to: [{ email: to }],
          subject: subject,
          dynamic_template_data: templateData,
        },
      ],
      from: { email: fromEmail },
      template_id: templateId,
    };

    console.log('Sending email to SendGrid (Legacy):', { to, templateId });

    try {
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.SENDGRID_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('SendGrid API error:', errorText);
        throw new AppError(response.status, `SendGrid API error: ${errorText}`, 'SENDGRID_API_ERROR');
      }
    } catch (error) {
       if (error instanceof AppError) throw error;
       console.error('Failed to send email:', error);
       throw new AppError(500, 'Failed to send email', 'EMAIL_SEND_FAILED');
    }
  }

  async sendConfirmationEmail(
    env: Env,
    to: string,
    projectName: string,
    confirmationUrl: string,
    projectId?: string
  ): Promise<void> {
    const templateData: ConfirmationEmailData = {
      project_name: projectName,
      app_name: projectName,
      confirmation_url: confirmationUrl,
      action_url: confirmationUrl,
    } as any;

    await this.sendEmail(
      env,
      to,
      'confirmation',
      templateData,
      `Confirm your email for ${projectName}`,
      projectId
    );
  }

  async sendPasswordResetEmail(
    env: Env,
    to: string,
    resetUrl: string,
    projectName?: string,
    projectId?: string
  ): Promise<void> {
    const name = projectName || 'Auth Service';
    const templateData: PasswordResetEmailData = {
      reset_url: resetUrl,
      project_name: name,
      app_name: name,
      action_url: resetUrl,
    } as any;

    await this.sendEmail(
      env,
      to,
      'passwordReset',
      templateData,
      `Reset your password for ${name}`,
      projectId
    );
  }

  async sendWelcomeEmail(
    env: Env,
    to: string,
    projectName: string,
    extraData?: string,
    projectId?: string
  ): Promise<void> {
    const templateData: WelcomeEmailData = {
      project_name: projectName,
      extra_data: extraData,
      app_name: projectName, // Alias
    } as any;

    await this.sendEmail(
      env,
      to,
      'welcome',
      templateData,
      `Welcome to ${projectName}!`,
      projectId
    );
  }
}

// Export singleton instance
export const emailService = new EmailService();
