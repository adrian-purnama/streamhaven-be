const axios = require('axios');

/**
 * Verify reCAPTCHA response token with Google.
 * @param {string} token - The reCAPTCHA response token from the client
 * @param {string} [remoteIp] - Optional user IP
 * @returns {Promise<{ success: boolean, errorCodes?: string[] }>}
 */
async function verifyRecaptcha(token, remoteIp) {
  const secret = process.env.SECRET_KEY || process.env.RECAPTCHA_SECRET_KEY;
  if (!secret) {
    return { success: false, errorCodes: ['missing-secret'] };
  }
  if (!token || typeof token !== 'string' || !token.trim()) {
    return { success: false, errorCodes: ['missing-input-response'] };
  }
  try {
    const params = new URLSearchParams({
      secret,
      response: token.trim(),
    });
    if (remoteIp) params.append('remoteip', remoteIp);
    const { data } = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      params.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      }
    );
    return {
      success: Boolean(data?.success),
      errorCodes: data?.['error-codes'] || [],
    };
  } catch (err) {
    return { success: false, errorCodes: ['verification-failed'] };
  }
}

module.exports = { verifyRecaptcha };
