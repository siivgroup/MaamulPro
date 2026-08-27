import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { randomUUID } from 'crypto';
import { EmailContent, renderEmail } from './email-template';

export type EmailAttachment = {
  filename: string;
  content: string | Buffer;
};

export type SendEmailInput = {
  to: string[];
  content: EmailContent;
  attachments?: EmailAttachment[];
};

@Injectable()
export class ResendEmailService {
  private readonly logger = new Logger(ResendEmailService.name);

  isConfigured() {
    return Boolean(
      String(process.env.RESEND_API_KEY || '').trim()
      && String(process.env.RESEND_FROM || '').trim(),
    );
  }

  async send(input: SendEmailInput) {
    const reference = randomUUID();
    const log = (event: string, id?: string) => JSON.stringify({ event, template: input.content.template, reference, ...(id ? { providerId: id } : {}) });
    if (!this.isConfigured()) {
      this.logger.warn(log('email_disabled'));
      return { sent: false as const };
    }

    let rendered: ReturnType<typeof renderEmail>;
    try { rendered = renderEmail(input.content); }
    catch {
      this.logger.error(log('email_render_or_configuration_failed'));
      return { sent: false as const, reason: 'delivery_failed' as const };
    }
    try {
      const resend = new Resend(process.env.RESEND_API_KEY!.trim());
      const { data, error } = await resend.emails.send({
        from: process.env.RESEND_FROM!.trim(),
        to: input.to,
        ...rendered,
        ...(process.env.EMAIL_SUPPORT_ADDRESS ? { replyTo: process.env.EMAIL_SUPPORT_ADDRESS.trim() } : {}),
        ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      });
      if (error || !data?.id || typeof data.id !== 'string') {
        this.logger.error(log(error ? 'email_provider_rejected' : 'email_provider_unconfirmed'));
        return { sent: false as const, reason: 'delivery_failed' as const };
      }
      this.logger.log(log('email_provider_accepted', data.id));
      // Acceptance by Resend does not confirm delivery to the recipient's inbox.
      return { sent: true as const, id: data.id };
    } catch {
      this.logger.error(log('email_send_failed'));
      return { sent: false as const, reason: 'delivery_failed' as const };
    }
  }
}
