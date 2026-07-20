import 'server-only';
import nodemailer from 'nodemailer';

// Sends via a regular Gmail account using an "App Password" — Gmail
// rejects plain account passwords for SMTP. Generate one at
// https://myaccount.google.com/apppasswords (requires 2-Step Verification
// to be enabled on the account first).
export function getMailTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error('GMAIL_USER / GMAIL_APP_PASSWORD are not configured.');
  }

  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}
