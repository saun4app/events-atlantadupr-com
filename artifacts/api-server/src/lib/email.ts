// Resend integration (Replit connector "resend").
// Uses @replit/connectors-sdk proxy which handles identity, token refresh, and
// auth headers automatically. Do not cache the client/token.
import { ReplitConnectors } from "@replit/connectors-sdk";

export interface SendVerificationEmailParams {
  to: string;
  code: string;
  from: string;
  replyTo?: string;
  eventName?: string;
}

function buildHtml(code: string, eventName?: string): string {
  const subjectLine = eventName
    ? `Your verification code for ${eventName}`
    : "Your verification code";
  return `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
    <h2 style="margin: 0 0 12px;">Atlanta DUPR Pickleball</h2>
    <p style="margin: 0 0 16px; font-size: 15px; color: #444;">${subjectLine}. Enter this code to confirm your registration:</p>
    <div style="font-size: 32px; font-weight: 700; letter-spacing: 8px; background: #f4f4f5; border-radius: 8px; padding: 16px; text-align: center; margin: 0 0 16px;">${code}</div>
    <p style="margin: 0; font-size: 13px; color: #888;">This code expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
  </div>`;
}

export async function sendVerificationEmail(params: SendVerificationEmailParams): Promise<void> {
  const { to, code, from, replyTo, eventName } = params;
  const connectors = new ReplitConnectors();

  const subject = eventName
    ? `Your code for ${eventName}: ${code}`
    : `Your verification code: ${code}`;

  const payload: Record<string, unknown> = {
    from,
    to: [to],
    subject,
    html: buildHtml(code, eventName),
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
  };
  if (replyTo) payload.reply_to = replyTo;

  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend send failed (${response.status}): ${detail}`);
  }
}
