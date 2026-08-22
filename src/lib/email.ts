import { env, isProd } from "./env";
import { logger } from "./logger";

/**
 * Provider-agnostic mailer. Templates live in
 * src/modules/notifications/templates — this file only knows how to put bytes
 * on the wire.
 *
 * `console` prints the message (including any link) to the server log, which is
 * what local development uses until Mailpit or a real provider is configured.
 */

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface Mailer {
  readonly name: string;
  send(message: MailMessage): Promise<void>;
}

let warnedAboutConsoleInProd = false;

const consoleMailer: Mailer = {
  name: "console",
  async send(message) {
    // Warned on first send rather than at module load: the module is also
    // evaluated during `next build`, where NODE_ENV is production but no mail
    // is being sent and the warning is just noise.
    if (isProd && !warnedAboutConsoleInProd) {
      warnedAboutConsoleInProd = true;
      logger.error(
        "EMAIL_PROVIDER=console in production — invites and password resets are being written to the log instead of delivered",
      );
    }
    logger.info(
      { to: message.to, subject: message.subject, body: message.text },
      "email (console transport)",
    );
  },
};

function smtpMailer(): Mailer {
  return {
    name: "smtp",
    async send(message) {
      if (!env.SMTP_URL) throw new Error("EMAIL_PROVIDER=smtp requires SMTP_URL");
      const { createTransport } = await import("nodemailer");
      const transport = createTransport(env.SMTP_URL);
      await transport.sendMail({
        from: env.EMAIL_FROM,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      });
    },
  };
}

function resendMailer(): Mailer {
  return {
    name: "resend",
    async send(message) {
      if (!env.RESEND_API_KEY) throw new Error("EMAIL_PROVIDER=resend requires RESEND_API_KEY");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { reply_to: message.replyTo } : {}),
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Resend rejected the message (${response.status}): ${body}`);
      }
    },
  };
}

function selectMailer(): Mailer {
  switch (env.EMAIL_PROVIDER) {
    case "smtp":
      return smtpMailer();
    case "resend":
      return resendMailer();
    default:
      return consoleMailer;
  }
}

export const mailer: Mailer = selectMailer();

/** Minimal shell so every transactional email looks like it came from one system. */
export function renderEmailShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#18181b">
    <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600">${escapeHtml(title)}</h1>
      ${bodyHtml}
      <p style="margin:32px 0 0;font-size:12px;color:#71717a">
        Sent by HRMS. If you were not expecting this email you can ignore it.
      </p>
    </div>
  </body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
