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

export interface SendFailureAlertParams {
  to: string[];
  from: string;
  recipientAddress: string;
  eventName: string | undefined;
  errorMessage: string;
}

export async function sendFailureAlertEmail(params: SendFailureAlertParams): Promise<void> {
  const { to, from, recipientAddress, eventName, errorMessage } = params;
  const connectors = new ReplitConnectors();

  const eventLabel = eventName ? ` for "${eventName}"` : "";
  const subject = `[Alert] Verification email failed to send${eventLabel}`;
  const timestamp = new Date().toISOString();

  const html = `
  <div style="font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
    <h2 style="margin: 0 0 12px; color: #b91c1c;">Verification Email Failure</h2>
    <p style="margin: 0 0 16px; font-size: 15px;">A player was unable to receive their verification code. Details below:</p>
    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="padding: 6px 8px; background: #f4f4f5; font-weight: 600; width: 140px;">Recipient</td><td style="padding: 6px 8px; border: 1px solid #e4e4e7;">${recipientAddress}</td></tr>
      <tr><td style="padding: 6px 8px; background: #f4f4f5; font-weight: 600;">Event</td><td style="padding: 6px 8px; border: 1px solid #e4e4e7;">${eventName ?? "—"}</td></tr>
      <tr><td style="padding: 6px 8px; background: #f4f4f5; font-weight: 600;">Time (UTC)</td><td style="padding: 6px 8px; border: 1px solid #e4e4e7;">${timestamp}</td></tr>
      <tr><td style="padding: 6px 8px; background: #f4f4f5; font-weight: 600;">Resend Error</td><td style="padding: 6px 8px; border: 1px solid #e4e4e7; font-family: monospace; white-space: pre-wrap; word-break: break-all;">${errorMessage}</td></tr>
    </table>
    <p style="margin: 16px 0 0; font-size: 13px; color: #888;">Check your Resend account for domain verification status and rate limits. The player may need to be assisted manually.</p>
  </div>`;

  const text = [
    "Verification Email Failure",
    "",
    `Recipient:   ${recipientAddress}`,
    `Event:       ${eventName ?? "—"}`,
    `Time (UTC):  ${timestamp}`,
    `Resend Error: ${errorMessage}`,
    "",
    "Check your Resend account for domain verification status and rate limits.",
  ].join("\n");

  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend alert send failed (${response.status}): ${detail}`);
  }
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

export interface SendBroadcastEmailParams {
  to: string[];
  from: string;
  replyTo?: string;
  subject: string;
  body: string;
}

export async function sendBroadcastEmail(params: SendBroadcastEmailParams): Promise<void> {
  const { to, from, replyTo, subject, body } = params;
  if (to.length === 0) return;

  const connectors = new ReplitConnectors();
  const payload: Record<string, unknown> = {
    from,
    to: [from],
    bcc: to,
    subject,
    text: body,
  };
  if (replyTo) payload.reply_to = replyTo;

  const response = await connectors.proxy("resend", "/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Resend broadcast failed (${response.status}): ${detail}`);
  }
}
