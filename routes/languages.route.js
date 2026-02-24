const express = require('express');
const { tmdbApi } = require('../helper/api.helper');
const UploadedVideoModel = require('../model/uploadedVideo.model');
const StagingSubtitleModel = require('../model/stagingSubtitle.model');
const { getSubtitleBuffer } = require('../model/subtitleGridFs.model');
const { validateWebhookSecret } = require('../helper/validate.helper');
const { putSubtitleToAbyss, getVideoSubtitle } = require('../helper/abyss.helper');
const { verifyRecaptcha } = require('../helper/recaptcha.helper');
require('dotenv').config();
const axios = require('axios');
const router = express.Router();

const DOWNLOADER_URL = (process.env.DOWNLOADER_URL || '').replace(/\/$/, '');
const SNIFFER_URL = (process.env.DOWNLOADER_URL || process.env.DOWNLOADER_URL || '').replace(/\/$/, '');

/**
 * GET /api/languages
 * Returns TMDB list of languages (iso_639_1, english_name) for dropdowns.
 * @see https://developer.themoviedb.org/reference/configuration-languages
 */
router.get('/', async (req, res) => {
  try {
    const response = await tmdbApi.get('/configuration/languages');
    const list = response.data || [];
    return res.status(200).json({
      success: true,
      data: list,
    });
  } catch (err) {
    const message = err.response?.data?.status_message || err.message || 'Failed to fetch languages';
    return res.status(err.response?.status || 500).json({ success: false, message });
  }
});


const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/** Map Abyss language name (lowercase) to ISO 639-1 code. Used so we treat Abyss as source of truth for "downloaded". */
const ABYSS_NAME_TO_CODE = {
  english: 'en', spanish: 'es', french: 'fr', german: 'de', italian: 'it', portuguese: 'pt',
  japanese: 'ja', korean: 'ko', chinese: 'zh', arabic: 'ar', russian: 'ru', hindi: 'hi',
  dutch: 'nl', polish: 'pl', swedish: 'sv', danish: 'da', finnish: 'fi', norwegian: 'no',
  czech: 'cs', turkish: 'tr', thai: 'th', vietnamese: 'vi', indonesian: 'id', romanian: 'ro',
  greek: 'el', hebrew: 'he', hungarian: 'hu', ukrainian: 'uk', malay: 'ms', croatian: 'hr',
  bulgarian: 'bg', slovak: 'sk', slovenian: 'sl', serbian: 'sr', persian: 'fa', farsi_persian: 'fa',
  bengali: 'bn', tamil: 'ta', telugu: 'te', malayalam: 'ml', urdu: 'ur', latvian: 'lv',
  lithuanian: 'lt', estonian: 'et', bosnian: 'bs', sinhala: 'si', chinese_bg_code: 'zh',
  big_5_code: 'zh', brazilian_portuguese: 'pt', spanish_latin_america: 'es', albanian: 'al',
};

function abyssNameToCode(name) {
  if (!name || typeof name !== 'string') return null;
  const s = name.trim().toLowerCase();
  if (s.length === 2) return s;
  return ABYSS_NAME_TO_CODE[s] || null;
}

/**
 * GET /api/languages/subtitle-available?externalId=123
 * Returns available subtitles for a video. Uses cached list if fresh (<30 days),
 * otherwise fetches from the Python downloader and caches the result.
 * Also checks Abyss remote (by slug). downloadedSubtitles = only languages that exist on Abyss (source of truth).
 */
router.get('/subtitle-available', async (req, res) => {
  const { externalId } = req.query;
  try {
    if (!externalId) {
      return res.status(400).json({ success: false, message: 'externalId is required' });
    }
    const id = Number(externalId);
    if (Number.isNaN(id)) {
      return res.status(400).json({ success: false, message: 'externalId must be a number' });
    }

    const uploadedVideo = await UploadedVideoModel.findOne({ externalId: id });
    if (!uploadedVideo) {
      return res.status(404).json({ success: false, message: 'Uploaded video not found' });
    }

    const sub = uploadedVideo.subtitle || {};
    const cached = sub.availableSubtitles || [];
    const lastFetch = sub.lastCacheAvailableSubtitles;
    const cacheValid = lastFetch && (Date.now() - new Date(lastFetch).getTime()) < THIRTY_DAYS_MS && cached.length > 0;

    // Always check Abyss for subtitles actually on the video (by slug)
    let subtitleOnAbyss = [];
    const slug = uploadedVideo.abyssSlug;
    if (slug && typeof slug === 'string') {
      try {
        const raw = await getVideoSubtitle(slug);
        const list = Array.isArray(raw) ? raw : [];
        subtitleOnAbyss = list
          .map((item) => {
            if (!item || typeof item !== 'object') return null;
            const name = item.name ?? item.language ?? item.label;
            if (name == null) return null;
            return { name: String(name) };
          })
          .filter(Boolean);
      } catch (err) {
        console.error('[subtitle-available] Abyss getVideoSubtitle failed:', err?.message);
      }
    }

    // Use Abyss as source of truth: "downloaded" only if it exists on Abyss (fixes DB/Abyss drift e.g. zh in DB but not on Abyss)
    const codesOnAbyss = subtitleOnAbyss
      .map((o) => abyssNameToCode(o.name))
      .filter(Boolean);
    const dbDownloaded = sub.downloadedSubtitles || [];
    const downloadedSubtitles = dbDownloaded.filter((code) => codesOnAbyss.includes(code));

    // If DB has codes that are not on Abyss, remove the drift from the DB
    if (dbDownloaded.length !== downloadedSubtitles.length || dbDownloaded.some((c, i) => c !== downloadedSubtitles[i])) {
      await UploadedVideoModel.updateOne(
        { _id: uploadedVideo._id },
        { $set: { 'subtitle.downloadedSubtitles': downloadedSubtitles } }
      );
    }

    const baseData = {
      downloadedSubtitles,
      subtitleOnAbyss,
    };

    if (cacheValid) {
      return res.status(200).json({
        success: true,
        data: {
          availableSubtitles: cached,
          ...baseData,
          fromCache: true,
        },
      });
    }

    // Fetch fresh from Python downloader
    const title = uploadedVideo.title || '';
    if (!title) {
      return res.status(400).json({ success: false, message: 'Video has no title for subtitle search' });
    }
    const { data: pyRes } = await axios.get(`${DOWNLOADER_URL}/available-subtitles`, {
      params: { title },
      timeout: 30000,
    });

    if (pyRes?.success && pyRes.data?.languages?.length) {
      const shortCodes = pyRes.data.languages.map((l) => l.short);
      await UploadedVideoModel.updateOne(
        { _id: uploadedVideo._id },
        {
          $set: {
            'subtitle.availableSubtitles': shortCodes,
            'subtitle.lastCacheAvailableSubtitles': new Date(),
          },
        }
      );
      return res.status(200).json({
        success: true,
        data: {
          availableSubtitles: shortCodes,
          ...baseData,
          fromCache: false,
        },
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        availableSubtitles: [],
        ...baseData,
        fromCache: false,
      },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to check subtitle availability',
    });
  }
});

router.post('/download-subtitle', async (req, res) => {
  const { externalId, language, recaptchaToken } = req.body || {};
  try {
    if (!externalId || !language) {
      return res.status(400).json({ success: false, message: 'externalId and language are required' });
    }
    if (process.env.SECRET_KEY || process.env.RECAPTCHA_SECRET_KEY) {
      const result = await verifyRecaptcha(recaptchaToken, req.ip || req.socket?.remoteAddress);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: 'Please complete the captcha verification',
        });
      }
    }
    const uploadedVideo = await UploadedVideoModel.findOne({ externalId: Number(externalId) });
    if (!uploadedVideo) {
      return res.status(404).json({ success: false, message: 'Uploaded video not found' });
    }
    const downloaded = (uploadedVideo.subtitle?.downloadedSubtitles) || [];
    if (downloaded.includes(language)) {
      return res.status(200).json({ success: true, message: 'Subtitle already downloaded' });
    }
    const title = uploadedVideo.title || '';
    if (!title) {
      return res.status(400).json({ success: false, message: 'Video has no title for subtitle search' });
    }
    const { data: pyRes } = await axios.post(
      `${DOWNLOADER_URL}/download-subtitle`,
      { externalId, language, title },
      { timeout: 60000 }
    );
    if (pyRes?.success) {
      await UploadedVideoModel.updateOne(
        { _id: uploadedVideo._id },
        { $addToSet: { 'subtitle.downloadedSubtitles': language } }
      );
    }
    return res.status(200).json({
      success: true,
      message: pyRes?.message || 'Subtitle downloaded',
      data: pyRes,
    });
  } catch (err) {
    const msg = err.response?.data?.message || err.message || 'Failed to download subtitle';
    return res.status(500).json({ success: false, message: msg });
  }
});

/**
 * GET /api/languages/process-subtitle
 * Webhook: process all staging subtitles. For each: if no uploaded video for tmdbId, delete staging doc;
 * if uploaded video already has this language, delete staging doc; else add language to uploaded video.
 * Requires X-Webhook-Secret header.
 */
router.get('/process-subtitle', validateWebhookSecret, async (req, res) => {
  try {
    const stagingDocs = await StagingSubtitleModel.find({}).lean();
    let processed = 0;
    let deleted = 0;

    for (const doc of stagingDocs) {
      const uploadedVideo = await UploadedVideoModel.findOne({ externalId: doc.tmdbId });
      if (!uploadedVideo) {
        await StagingSubtitleModel.findByIdAndDelete(doc._id);
        deleted++;
        continue;
      }
      const downloaded = uploadedVideo.subtitle?.downloadedSubtitles || [];
      const alreadyHas = downloaded.includes(doc.language);
      if (alreadyHas) {
        await StagingSubtitleModel.findByIdAndDelete(doc._id);
        deleted++;
        continue;
      }
      // Load subtitle from GridFS and upload to Abyss
      try {
        const buffer = await getSubtitleBuffer(doc.gridFsFileId);
        if (!buffer || buffer.length === 0) {
          await StagingSubtitleModel.findByIdAndDelete(doc._id);
          deleted++;
          continue;
        }
        await putSubtitleToAbyss(uploadedVideo.abyssSlug, buffer, {
          language: doc.language,
          filename: doc.filename || `${doc.language}.srt`,
        });
        await StagingSubtitleModel.findByIdAndDelete(doc._id);
        await UploadedVideoModel.updateOne(
          { externalId: doc.tmdbId },
          { $addToSet: { 'subtitle.downloadedSubtitles': doc.language } }
        );
        processed++;
      } catch (err) {
        console.error('[process-subtitle] upload to Abyss failed for staging doc', doc._id, err.message);
        // Leave doc in staging; could set status to 'error' if desired
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Processed staging subtitles',
      data: { processed, deleted },
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: err.message || 'Failed to process subtitle',
    });
  }
});

module.exports = router;
