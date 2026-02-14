require('dotenv').config();

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const VERIFICATION_EMAIL = process.env.VERIFICATION_EMAIL;


async function sendEmail({ to, subject, htmlContent, textContent, sender }) {
  const { TransactionalEmailsApi, SendSmtpEmail } = await import('@getbrevo/brevo');
  const api = new TransactionalEmailsApi();

  api.authentications.apiKey.apiKey = BREVO_API_KEY;

  const sendSmtpEmail = new SendSmtpEmail();
  sendSmtpEmail.sender = sender ? { name: sender.name, email: sender.email } : { name: 'FC', email: 'noreply@amfphub.com' };
  sendSmtpEmail.to = [{ email: to.email, name: to.name || to.email }];
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = htmlContent || undefined;
  sendSmtpEmail.textContent = textContent || undefined;

  const data = await api.sendTransacEmail(sendSmtpEmail);
  return data;
}

const DEFAULT_APP_NAME = 'Stream Haven'

const buildOtpEmailHtml = (otp, appName = DEFAULT_APP_NAME, logoUrl = '') => {
  const safeLogoUrl = logoUrl && typeof logoUrl === 'string' && logoUrl.trim() ? logoUrl.trim() : ''
  const headerContent = safeLogoUrl
    ? `<img src="${escapeHtml(safeLogoUrl)}" alt="${escapeHtml(appName)}" style="max-height: 48px; width: auto; display: block; margin: 0 auto;" />`
    : `<h1 style="margin:0; font-size: 22px; font-weight: 700; color: #fbbf24; letter-spacing: -0.02em;">${escapeHtml(appName)}</h1>`
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your email</title>
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 420px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07); overflow: hidden;">
          <tr>
            <td style="padding: 32px 24px 24px; text-align: center; background: linear-gradient(180deg, #1f2937 0%, #111827 100%);">
              ${headerContent}
              <p style="margin: 12px 0 0; font-size: 13px; color: #9ca3af;">Email verification</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 24px;">
              <p style="margin:0 0 16px; font-size: 15px; color: #374151; line-height: 1.5;">Use this one-time code to complete your registration:</p>
              <div style="margin: 20px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; text-align: center;">
                <span style="font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #111827; font-family: 'SF Mono', Monaco, 'Courier New', monospace;">${escapeHtml(otp)}</span>
              </div>
              <p style="margin: 0; font-size: 13px; color: #6b7280;">This code expires in a few minutes. If you didn&apos;t request it, you can ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 24px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin:0; font-size: 12px; color: #9ca3af;">&copy; ${new Date().getFullYear()} ${escapeHtml(appName)}. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

function escapeHtml(text) {
  if (typeof text !== 'string') return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

const buildResetOtpEmailHtml = (otp, appName = DEFAULT_APP_NAME, logoUrl = '') => {
  const safeLogoUrl = logoUrl && typeof logoUrl === 'string' && logoUrl.trim() ? logoUrl.trim() : ''
  const headerContent = safeLogoUrl
    ? `<img src="${escapeHtml(safeLogoUrl)}" alt="${escapeHtml(appName)}" style="max-height: 48px; width: auto; display: block; margin: 0 auto;" />`
    : `<h1 style="margin:0; font-size: 22px; font-weight: 700; color: #fbbf24; letter-spacing: -0.02em;">${escapeHtml(appName)}</h1>`
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password</title>
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f3f4f6; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 420px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07); overflow: hidden;">
          <tr>
            <td style="padding: 32px 24px 24px; text-align: center; background: linear-gradient(180deg, #1f2937 0%, #111827 100%);">
              ${headerContent}
              <p style="margin: 12px 0 0; font-size: 13px; color: #9ca3af;">Reset your password</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 24px;">
              <p style="margin:0 0 16px; font-size: 15px; color: #374151; line-height: 1.5;">Use this one-time code to reset your password:</p>
              <div style="margin: 20px 0; padding: 20px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; text-align: center;">
                <span style="font-size: 28px; font-weight: 700; letter-spacing: 6px; color: #111827; font-family: 'SF Mono', Monaco, 'Courier New', monospace;">${escapeHtml(otp)}</span>
              </div>
              <p style="margin: 0; font-size: 13px; color: #6b7280;">This code expires in a few minutes. If you didn&apos;t request a reset, you can ignore this email.</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 16px 24px; border-top: 1px solid #e5e7eb; text-align: center;">
              <p style="margin:0; font-size: 12px; color: #9ca3af;">&copy; ${new Date().getFullYear()} ${escapeHtml(appName)}. All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim()
}

const sendOtpEmail = async (email, otp, appName = DEFAULT_APP_NAME, logoUrl = '') => {
  const htmlContent = buildOtpEmailHtml(otp, appName, logoUrl)
  const textContent = `
${appName} – Email verification

Your one-time code is: ${otp}

This code expires in a few minutes. If you didn't request it, you can ignore this email.
  `.trim()
  await sendEmail({
    to: { email },
    subject: `${appName} – Verify your email`,
    htmlContent,
    textContent,
    sender: { name: appName, email: VERIFICATION_EMAIL },
  })
}

const sendResetOtpEmail = async (email, otp, appName = DEFAULT_APP_NAME, logoUrl = '') => {
  const htmlContent = buildResetOtpEmailHtml(otp, appName, logoUrl)
  const textContent = `
${appName} – Reset your password

Your one-time code is: ${otp}

This code expires in a few minutes. If you didn't request a reset, you can ignore this email.
  `.trim()
  await sendEmail({
    to: { email },
    subject: `${appName} – Reset your password`,
    htmlContent,
    textContent,
    sender: { name: appName, email: VERIFICATION_EMAIL },
  })
}

module.exports = { sendOtpEmail, sendResetOtpEmail };