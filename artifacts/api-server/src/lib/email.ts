export interface SendVerificationEmailParams {
  to: string;
  code: string;
  from: string;
  eventName?: string;
}

export async function sendVerificationEmail(_params: SendVerificationEmailParams): Promise<void> {
  throw new Error("Email delivery is not yet configured (Resend connector pending)");
}
