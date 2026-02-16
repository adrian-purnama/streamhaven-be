const axios = require('axios');
const FormData = require('form-data');
require('dotenv').config();
const systemModel = require('../model/system.model');
const { abyssApi, AbyssBaseURL, AbyssApiKey } = require('./api.helper');

const ABYSS_EMAIL = process.env.ABYSS_EMAIL;
const ABYSS_PASSWORD = process.env.ABYSS_PASSWORD;
const ABYSS_API_KEY = process.env.ABYSS_API_KEY;
const ABYSS_LINK = process.env.ABYSS_LINK;
const ABYSS_LINK_2 = process.env.ABYSS_LINK_2;

const ABYSS_UPLOAD_URL = ABYSS_LINK_2 + '/' + ABYSS_API_KEY;

/**
 * Get a valid Abyss token: from system doc if present and not expired, else login and save.
 */
async function getAbyssToken() {
  const system = await systemModel.findOne({}).lean();
  if (!system) {
    throw new Error('System document not found; run server so populateSystem creates it.');
  }

  const stored = system.abyssToken;
  const now = Date.now();
  if (stored?.token && stored.expiresAt && new Date(stored.expiresAt).getTime() > now) {
    return stored.token;
  }

  if (!ABYSS_EMAIL || !ABYSS_PASSWORD) {
    throw new Error('ABYSS_EMAIL and ABYSS_PASSWORD must be set in .env to get Abyss token.');
  }

  const loginRes = await abyssApi.post('/auth/login', {
    email: ABYSS_EMAIL,
    password: ABYSS_PASSWORD,
  });


  const data = loginRes.data?.data ?? loginRes.data;
  const token = data?.token ?? data?.accessToken ?? data?.access_token;
  const expiresAt = data?.expiresAt ?? data?.expires_at ?? data?.expiresAtMs;
  if (!token) {
    throw new Error('Abyss login did not return a token. Check response shape.');
  }

  await systemModel.updateOne(
    {},
    {
      $set: {
        'abyssToken.token': token,
        'abyssToken.expiresAt': expiresAt ? new Date(expiresAt) : new Date(now + 24 * 60 * 60 * 1000),
      },
    }
  );

  return token;
}

/**
 * Call Abyss API with current token (e.g. GET /v1/about).
 */
async function getAccountInfo() {
  const token = await getAbyssToken();
  const response = await axios.get(`${AbyssBaseURL}/v1/about`, {
    headers: {
      Authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });
  return response.data;
}

/**
 * Check if we can upload a file of given size based on Abyss account info.
 * Adapt data.* to match your Abyss API response (e.g. storage.used/limit, daily.used/limit, maxUploads).
 * @param {object} accountInfo - raw getAccountInfo() result (may be { data: { ... } })
 * @param {number} fileSizeBytes
 * @returns {{ canUpload: boolean, failStatus: 'storage_fail'|'daily_fail'|'max_upload_fail'|null }}
 */
function checkUploadQuota(accountInfo, fileSizeBytes) {
  const data = accountInfo?.data ?? accountInfo ?? {};
  const storageUsed = data.storage?.used ?? data.storageUsed ?? 0;
  const storageLimit = data.storage?.limit ?? data.storageLimit ?? 0;
  const dailyUsed = data.daily?.used ?? data.dailyUsed ?? data.dailyUploadUsed ?? 0;
  const dailyLimit = data.daily?.limit ?? data.dailyLimit ?? data.dailyUploadLimit ?? 0;
  const maxUploads = data.maxUploads ?? data.max_uploads ?? null;
  const uploadsCount = data.uploadsCount ?? data.uploads_count ?? 0;

  if (storageLimit > 0 && storageUsed + fileSizeBytes > storageLimit) {
    return { canUpload: false, failStatus: 'storage_fail' };
  }
  if (dailyLimit > 0 && dailyUsed >= dailyLimit) {
    return { canUpload: false, failStatus: 'daily_fail' };
  }
  if (maxUploads != null && uploadsCount >= maxUploads) {
    return { canUpload: false, failStatus: 'max_upload_fail' };
  }
  return { canUpload: true, failStatus: null };
}

/**
 * Upload video stream to Abyss/Hydrax (multipart/form-data).
 * Expects ABYSS_UPLOAD_URL in env (e.g. http://up.hydrax.net/YOUR_UPLOAD_KEY).
 * Response: { status: true, slug } on success, { status: false, msg } on error.
 * @param {NodeJS.ReadableStream} stream
 * @param {{ filename: string, contentType: string, size: number }}
 * @returns {Promise<{ slug: string }>}
 */
async function uploadVideoToAbyss(stream, { filename, contentType, size }) {
  if (!ABYSS_UPLOAD_URL) {
    throw new Error('ABYSS_UPLOAD_URL is not set in .env. Set it to your Abyss/Hydrax upload URL (e.g. http://up.hydrax.net/YOUR_KEY).');
  }
  const form = new FormData();
  const fileOpts = {
    filename: filename || 'video.mp4',
    contentType: contentType || 'video/mp4',
  };
  if (size != null && Number.isFinite(size) && size > 0) {
    fileOpts.knownLength = size;
  }
  form.append('file', stream, fileOpts);
  const response = await axios.post(ABYSS_UPLOAD_URL, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    validateStatus: () => true,
  });
  const body = response.data;
  if (body && body.status === true && body.slug) {
    return { slug: body.slug };
  }
  // "Payload Too Large" = response.statusText when server returns HTTP 413 (Abyss or proxy rejected upload size)
  const msg = body?.msg || body?.message || response.statusText || 'Upload failed';
  console.error('[abyss] Upload failed:', {
    status: response.status,
    statusText: response.statusText,
    bodyMsg: body?.msg ?? body?.message,
    url: ABYSS_UPLOAD_URL
  });
  throw new Error(msg);
}

/**
 * Fetch file/slug status on Abyss (GET /v1/files/:id). Uses Bearer token like getAccountInfo.
 * @param {string} slug - file id (slug) returned from upload
 * @returns {Promise<'uploaded_not_ready'|'ready'>}
 */
async function getSlugStatus(slug) {
  const token = await getAbyssToken();
  const response = await axios.get(`${AbyssBaseURL}/v1/files/${slug}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      accept: 'application/json',
    },
  });
  console.log(response.data.status);
  if(response.data.status === 'ready') {
    return 'ready';
  }
  return 'uploaded_not_ready';
}

module.exports = {
  getAbyssToken,
  getAccountInfo,
  checkUploadQuota,
  uploadVideoToAbyss,
  getSlugStatus,
};
