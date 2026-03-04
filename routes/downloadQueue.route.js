const express = require('express');
const axios = require('axios');
const { validateToken, validateAdmin, validateWebhookSecret } = require('../helper/validate.helper');
const { getPosterUrl } = require('../helper/movietv.helper');
const { fetchTvDetails, getTvSeasonsSummary, getTvSeasonsEpisodes } = require('../helper/tmdb.helper');
const DownloadQueueModel = require('../model/downloadQueue.model');
const DownloadSeriesQueueModel = require('../model/downloadSeriesQueue.model');
const StagingVideoModel = require('../model/stagingVideo.model');
const UploadedVideoModel = require('../model/uploadedVideo.model');

const router = express.Router();

// -----------------------------------------------------------------------------
// Config
// -----------------------------------------------------------------------------
// TV series: parent (show) in DownloadQueue, episode jobs in DownloadSeriesQueue.
// The Python downloader (downloader/server.py) must read "waiting" jobs from both
// collections (downloadqueues + downloadseriesqueue) and update status on the correct doc.

const DOWNLOADER_URL = (process.env.DOWNLOADER_URL || '').replace(/\/$/, '');
const SNIFFER_URL = (process.env.DOWNLOADER_URL || process.env.DOWNLOADER_URL || '').replace(/\/$/, '');


function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Use validateWebhookSecret from validate.helper for webhook routes (X-Webhook-Secret header).

// -----------------------------------------------------------------------------
// GET / — List queue (optional ?status=, ?limit=, ?skip=)
// Movies + TV series (1 item per show; no episodes). Episodes fetched when season expanded.
// -----------------------------------------------------------------------------

router.get('/', validateToken, validateAdmin, async (req, res) => {
  try {
    const status = req.query.status?.trim() || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 100);
    const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);

    const movieQuery = status ? { status, mediaType: 'movie' } : { mediaType: 'movie' };
    const rawMovies = await DownloadQueueModel.find(movieQuery)
      .populate('requester.id', 'email')
      .sort({ createdAt: -1 })
      .lean();

    // TV parents have no workflow status; only children (DownloadSeriesQueue) do
    const rawParents = await DownloadQueueModel.find({ mediaType: 'tv' }).sort({ createdAt: -1 }).lean();
    const parentIds = rawParents.map((p) => p._id);

    // Episode counts per parent+season and per parent+status (for totalEpisodes / downloadedCount / hasInProgress / pendingCount / waitingCount / failedCount)
    let countsByParentSeason = {}; // pid -> { seasonNum -> { total, done } }
    let inProgressByParent = {}; // pid -> true if any downloading/uploading
    let pendingCountByParent = {}; // pid -> count of pending episodes
    let waitingCountByParent = {}; // pid -> count of waiting episodes
    let failedCountByParent = {}; // pid -> count of failed episodes
    if (parentIds.length > 0) {
      const epMatch = status ? { parentId: { $in: parentIds }, status } : { parentId: { $in: parentIds } };
      const agg = await DownloadSeriesQueueModel.aggregate([
        { $match: epMatch },
        { $group: { _id: { parentId: '$parentId', seasonNumber: '$seasonNumber', status: '$status' }, count: { $sum: 1 } } },
      ]);
      for (const row of agg) {
        const pid = (row._id.parentId != null ? String(row._id.parentId) : '');
        const sn = row._id.seasonNumber ?? 0;
        const st = row._id.status;
        if (!countsByParentSeason[pid]) countsByParentSeason[pid] = {};
        if (!countsByParentSeason[pid][sn]) countsByParentSeason[pid][sn] = { total: 0, done: 0 };
        countsByParentSeason[pid][sn].total += row.count;
        if (st === 'done') countsByParentSeason[pid][sn].done += row.count;
        if (st === 'downloading' || st === 'uploading') inProgressByParent[pid] = true;
        if (st === 'pending') pendingCountByParent[pid] = (pendingCountByParent[pid] || 0) + row.count;
        if (st === 'waiting') waitingCountByParent[pid] = (waitingCountByParent[pid] || 0) + row.count;
        if (st === 'failed') failedCountByParent[pid] = (failedCountByParent[pid] || 0) + row.count;
      }
    }

    const mapRequester = (item) => {
      const populated = item.requester?.id;
      const requesterEmail = populated?.email ?? null;
      const requesterType = item.requester?.type ?? null;
      return { requesterEmail, requesterType };
    };

    const movieList = rawMovies.map((item) => {
      const { requesterEmail, requesterType } = mapRequester(item);
      return {
        ...item,
        poster_url: getPosterUrl(item.poster_path, 'w200') || null,
        requesterEmail,
        requesterType,
      };
    });

    const showPosterUrl = (path) => getPosterUrl(path, 'w200') || null;
    const seriesList = rawParents.map((parent) => {
      const pid = parent._id.toString();
      const meta = parent.seasonMetadata || [];
      const counts = countsByParentSeason[pid] || {};
      const seasonNumbers = [...new Set([...meta.map((s) => s.seasonNumber), ...Object.keys(counts).map(Number)])].filter(
        (n) => n != null && !Number.isNaN(n)
      );
      const seasons = seasonNumbers.sort((a, b) => a - b).map((seasonNumber) => {
        const m = meta.find((s) => s.seasonNumber === seasonNumber);
        const c = counts[seasonNumber] || { total: 0, done: 0 };
        const posterPath = m?.posterPath ?? m?.seasonPosterPath ?? null;
        const seasonPosterUrl = showPosterUrl(posterPath) || showPosterUrl(parent.poster_path);
        return {
          seasonNumber,
          name: m?.name ?? null,
          posterPath: posterPath || null,
          seasonPosterUrl,
          episodeCount: c.total,
          downloadedCount: c.done,
        };
      });
      const totalEpisodes = seasons.reduce((sum, s) => sum + (s.episodeCount || 0), 0);
      const downloadedCount = seasons.reduce((sum, s) => sum + (s.downloadedCount || 0), 0);
      return {
        _id: parent._id,
        tmdbId: parent.tmdbId,
        title: parent.title,
        showTitle: parent.title,
        poster_path: parent.poster_path,
        poster_url: showPosterUrl(parent.poster_path),
        mediaType: 'tv',
        createdAt: parent.createdAt,
        seasons,
        totalEpisodes,
        downloadedCount,
        pendingCount: pendingCountByParent[pid] || 0,
        waitingCount: waitingCountByParent[pid] || 0,
        failedCount: failedCountByParent[pid] || 0,
        hasInProgress: !!inProgressByParent[pid],
      };
    });

    const list = [...movieList, ...seriesList].sort(
      (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    );
    const total = list.length;
    const paginated = list.slice(skip, skip + limit);
    return res.json({ success: true, data: { list: paginated, total } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET /episodes — Episodes for a series (optional season). Used when season is expanded.
// Query: parentId (required), seasonNumber (optional)
// -----------------------------------------------------------------------------

router.get('/episodes', validateToken, validateAdmin, async (req, res) => {
  try {
    const parentId = req.query.parentId?.trim() || null;
    const seasonNumber = req.query.seasonNumber != null ? parseInt(req.query.seasonNumber, 10) : null;
    if (!parentId) {
      return res.status(400).json({ success: false, message: 'parentId required' });
    }
    const parent = await DownloadQueueModel.findById(parentId).lean();
    if (!parent || parent.mediaType !== 'tv') {
      return res.status(404).json({ success: false, message: 'Series not found' });
    }
    const showPosterUrl = getPosterUrl(parent.poster_path, 'w200') || null;
    const seasonMeta = parent.seasonMetadata || [];
    const query = { parentId };
    if (seasonNumber != null && !Number.isNaN(seasonNumber)) query.seasonNumber = seasonNumber;
    const rawEpisodes = await DownloadSeriesQueueModel.find(query)
      .populate('requester.id', 'email')
      .sort({ seasonNumber: 1, episodeNumber: 1 })
      .lean();
    const mapRequester = (item) => {
      const populated = item.requester?.id;
      return { requesterEmail: populated?.email ?? null, requesterType: item.requester?.type ?? null };
    };
    const episodes = rawEpisodes.map((ep) => {
      const season = seasonMeta.find((s) => s.seasonNumber === ep.seasonNumber);
      const seasonPosterPath = season?.posterPath ?? season?.seasonPosterPath ?? null;
      const seasonPosterUrl = getPosterUrl(seasonPosterPath, 'w200') || showPosterUrl;
      const { requesterEmail, requesterType } = mapRequester(ep);
      return {
        ...ep,
        tmdbId: parent.tmdbId,
        poster_path: parent.poster_path,
        showTitle: parent.title,
        mediaType: 'tv',
        poster_url: showPosterUrl,
        seasonPosterUrl,
        requesterEmail,
        requesterType,
      };
    });
    return res.json({ success: true, data: { episodes } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET /failed — List only failed items (movies + episodes with show info). For use in "Show failed" modal.
// -----------------------------------------------------------------------------

router.get('/failed', validateToken, validateAdmin, async (req, res) => {
  try {
    const failedMovies = await DownloadQueueModel.find({
      mediaType: 'movie',
      status: 'failed',
    })
      .sort({ createdAt: -1 })
      .lean();
    const movies = failedMovies.map((item) => ({
      ...item,
      poster_url: getPosterUrl(item.poster_path, 'w200') || null,
    }));

    const failedEpisodes = await DownloadSeriesQueueModel.find({ status: 'failed' })
      .sort({ createdAt: -1 })
      .lean();
    const parentIds = [...new Set(failedEpisodes.map((e) => e.parentId?.toString()).filter(Boolean))];
    const parents = await DownloadQueueModel.find({ _id: { $in: parentIds } }).lean();
    const parentMap = new Map(parents.map((p) => [p._id.toString(), p]));
    const showPosterUrl = (path) => getPosterUrl(path, 'w200') || null;
    const episodes = failedEpisodes.map((ep) => {
      const parent = parentMap.get(ep.parentId?.toString?.() || '');
      return {
        ...ep,
        showTitle: parent?.title ?? null,
        poster_url: showPosterUrl(parent?.poster_path) || null,
      };
    });

    return res.json({ success: true, data: { movies, episodes } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /reset-failed — Set all failed movies and all failed episodes to status 'pending'.
// -----------------------------------------------------------------------------

router.post('/reset-failed', validateToken, validateAdmin, async (req, res) => {
  try {
    const rMovies = await DownloadQueueModel.updateMany(
      { mediaType: 'movie', status: 'failed' },
      { $set: { status: 'pending' } }
    );
    const rEpisodes = await DownloadSeriesQueueModel.updateMany(
      { status: 'failed' },
      { $set: { status: 'pending' } }
    );
    const resetMovies = rMovies.modifiedCount ?? 0;
    const resetEpisodes = rEpisodes.modifiedCount ?? 0;
    return res.json({
      success: true,
      data: { resetMovies, resetEpisodes },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// DELETE /episodes — Delete all episodes for a series season (or whole series if no seasonNumber).
// Query: parentId (required), seasonNumber (optional; if omitted, deletes all episodes for the series).
// -----------------------------------------------------------------------------

router.delete('/episodes', validateToken, validateAdmin, async (req, res) => {
  try {
    const parentId = req.query.parentId?.trim() || null;
    const seasonNumber = req.query.seasonNumber != null ? parseInt(req.query.seasonNumber, 10) : null;
    if (!parentId) {
      return res.status(400).json({ success: false, message: 'parentId required' });
    }
    const parent = await DownloadQueueModel.findById(parentId).lean();
    if (!parent || parent.mediaType !== 'tv') {
      return res.status(404).json({ success: false, message: 'Series not found' });
    }
    const filter = { parentId };
    if (seasonNumber != null && !Number.isNaN(seasonNumber)) filter.seasonNumber = seasonNumber;
    const inProgress = await DownloadSeriesQueueModel.findOne({
      ...filter,
      status: { $in: ['downloading', 'uploading'] },
    }).lean();
    if (inProgress) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete while an episode is downloading or uploading',
      });
    }
    const result = await DownloadSeriesQueueModel.deleteMany(filter);
    return res.json({ success: true, data: { deleted: result.deletedCount } });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST / — Add item(s) to queue
// Body: title, tmdbId?, poster_path?, year?, mediaType? ('movie'|'tv')
// For TV: pass seasons: [{ seasonNumber, episodeCount }, ...] → creates one queue entry per episode.
// -----------------------------------------------------------------------------

router.post('/', validateToken, validateAdmin, async (req, res) => {
  try {
    const { title, tmdbId, poster_path, year, mediaType: rawMediaType, seasons: rawSeasons } = req.body || {};
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, message: 'title required' });
    }
    const mediaType = rawMediaType === 'tv' ? 'tv' : 'movie';
    const numTmdbId = tmdbId != null ? Number(tmdbId) : null;
    const posterPath = poster_path != null && String(poster_path).trim() ? String(poster_path).trim() : null;
    const yearNum = year != null ? Number(year) : null;
    const requester = { id: req.userId, type: 'admin' };

    const basePayload = {
      tmdbId: numTmdbId,
      poster_path: posterPath,
      year: yearNum,
      status: 'pending',
      requester,
    };

    if (mediaType === 'tv') {
      // TV series: fetch from TMDB (show + all seasons + per-season episodes), then save/merge.
      if (numTmdbId == null) {
        return res.status(400).json({ success: false, message: 'tmdbId required for TV' });
      }
      const tvDetails = await fetchTvDetails(numTmdbId);
      if (!tvDetails) {
        return res.status(404).json({ success: false, message: 'TV show not found for this TMDB id' });
      }
      const summary = getTvSeasonsSummary(tvDetails);
      if (!summary.seasons || summary.seasons.length === 0) {
        return res.status(400).json({ success: false, message: 'No seasons found for this show' });
      }
      const showTitle = (title && String(title).trim()) || tvDetails.name || 'Unknown Show';
      const posterPathFromApi = tvDetails.poster_path != null ? String(tvDetails.poster_path).trim() : null;
      const finalPosterPath = posterPath != null ? posterPath : posterPathFromApi;
      const yearFromApi =
        tvDetails.first_air_date != null && String(tvDetails.first_air_date).length >= 4
          ? parseInt(String(tvDetails.first_air_date).slice(0, 4), 10)
          : null;
      const finalYear = yearNum != null ? yearNum : yearFromApi;

      // Fetch per-season episode list (with names) from TMDB
      const episodesFromTmdb = [];
      for (const season of summary.seasons) {
        const sn = season.season_number ?? 0;
        try {
          const episodeList = await getTvSeasonsEpisodes(numTmdbId, sn);
          if (Array.isArray(episodeList)) {
            for (const ep of episodeList) {
              const epNum = ep.episode_number ?? 0;
              if (epNum < 1) continue;
              episodesFromTmdb.push({
                seasonNumber: sn,
                episodeNumber: epNum,
                episodeName: (ep.name && String(ep.name).trim()) || null,
              });
            }
          }
        } catch {
          // Skip season if API fails (e.g. not yet available)
        }
      }
      if (episodesFromTmdb.length === 0) {
        return res.status(400).json({ success: false, message: 'No episodes found for this show' });
      }

      const requestedSeasonMeta = summary.seasons.map((s) => ({
        seasonNumber: s.season_number ?? 0,
        name: s.name ?? `Season ${s.season_number ?? 0}`,
        posterPath: s.poster_path ?? null,
      }));

      const existingTv = await DownloadQueueModel.findOne({ tmdbId: numTmdbId, mediaType: 'tv' }).lean();

      if (existingTv) {
        // Merge: add only new (season, episode) pairs and update seasonMetadata from TMDB
        const parent = existingTv;
        const existingEpisodes = await DownloadSeriesQueueModel.find(
          { parentId: parent._id },
          { seasonNumber: 1, episodeNumber: 1 }
        )
          .lean();
        const existingSet = new Set(
          existingEpisodes.map((e) => `${e.seasonNumber},${e.episodeNumber}`)
        );

        const episodeDocs = [];
        for (const ep of episodesFromTmdb) {
          if (existingSet.has(`${ep.seasonNumber},${ep.episodeNumber}`)) continue;
          const label = `${showTitle} S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`;
          episodeDocs.push({
            parentId: parent._id,
            seasonNumber: ep.seasonNumber,
            episodeNumber: ep.episodeNumber,
            title: ep.episodeName || label,
            episodeName: ep.episodeName,
            status: 'pending',
            quality: 'high',
            requester,
          });
        }

        const metaBySeason = new Map(
          (parent.seasonMetadata || []).map((m) => [m.seasonNumber, { ...m }])
        );
        for (const m of requestedSeasonMeta) {
          const existing = metaBySeason.get(m.seasonNumber);
          metaBySeason.set(m.seasonNumber, {
            seasonNumber: m.seasonNumber,
            name: m.name ?? existing?.name ?? `Season ${m.seasonNumber}`,
            posterPath: m.posterPath ?? existing?.posterPath ?? null,
          });
        }
        const mergedSeasonMetadata = Array.from(metaBySeason.values()).sort(
          (a, b) => (a.seasonNumber || 0) - (b.seasonNumber || 0)
        );

        const metaChanged =
          JSON.stringify(mergedSeasonMetadata) !==
          JSON.stringify(parent.seasonMetadata || []);
        if (metaChanged || finalPosterPath !== parent.poster_path || finalYear !== parent.year) {
          await DownloadQueueModel.findByIdAndUpdate(parent._id, {
            $set: {
              seasonMetadata: mergedSeasonMetadata,
              ...(finalPosterPath != null && { poster_path: finalPosterPath }),
              ...(finalYear != null && { year: finalYear }),
            },
          });
        }

        let created = [];
        if (episodeDocs.length > 0) {
          created = await DownloadSeriesQueueModel.insertMany(episodeDocs);
        }

        const nothingNew = created.length === 0;
        return res.status(201).json({
          success: true,
          data: {
            created: created.length,
            updated: true,
            nothingNew,
            parent: { ...parent, seasonMetadata: mergedSeasonMetadata },
            items: created,
          },
        });
      }

      // New show: create parent + all episodes (with episode names from TMDB)
      const parent = await DownloadQueueModel.create({
        title: showTitle,
        tmdbId: numTmdbId,
        poster_path: finalPosterPath,
        year: finalYear,
        mediaType: 'tv',
        requester,
        seasonMetadata: requestedSeasonMeta,
      });
      const episodeDocs = episodesFromTmdb.map((ep) => {
        const label = `${showTitle} S${String(ep.seasonNumber).padStart(2, '0')}E${String(ep.episodeNumber).padStart(2, '0')}`;
        return {
          parentId: parent._id,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.episodeNumber,
          title: ep.episodeName || label,
          episodeName: ep.episodeName,
          status: 'pending',
          quality: 'high',
          requester,
        };
      });
      const created = await DownloadSeriesQueueModel.insertMany(episodeDocs);
      return res.status(201).json({
        success: true,
        data: { created: created.length, parent, items: created },
      });
    }

    // Single item (movie or single TV episode)
    if (mediaType === 'movie' && numTmdbId != null) {
      const [inQueue, inStaging, inUploaded] = await Promise.all([
        DownloadQueueModel.findOne({ tmdbId: numTmdbId, mediaType: 'movie' }).lean(),
        StagingVideoModel.findOne({ tmdbId: numTmdbId }).lean(),
        UploadedVideoModel.findOne({ externalId: numTmdbId }).lean(),
      ]);
      if (inQueue || inStaging || inUploaded) {
        return res.status(400).json({
          success: false,
          message: 'This movie is already in the queue, staging, or has been uploaded',
        });
      }
    }
    const doc = await DownloadQueueModel.create({
      ...basePayload,
      title: title.trim(),
      mediaType,
    });
    return res.status(201).json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// PATCH /:id — Update item (quality; only if pending or waiting). Id may be movie or episode.
// -----------------------------------------------------------------------------

router.patch('/:id', validateToken, validateAdmin, async (req, res) => {
  try {
    const { quality, status: newStatus } = req.body || {};
    if (quality != null && !['low', 'medium', 'high'].includes(quality)) {
      return res.status(400).json({ success: false, message: 'Invalid quality' });
    }
    if (newStatus != null && newStatus !== 'pending') {
      return res.status(400).json({ success: false, message: 'Invalid status transition' });
    }
    const update = {};
    if (quality != null) update.quality = quality;
    if (newStatus === 'pending') update.status = 'pending';
    if (Object.keys(update).length === 0) {
      const doc = await DownloadQueueModel.findById(req.params.id).lean()
        || await DownloadSeriesQueueModel.findById(req.params.id).lean();
      if (!doc) return res.status(404).json({ success: false, message: 'Queue item not found' });
      return res.json({ success: true, data: doc });
    }

    let doc = await DownloadQueueModel.findById(req.params.id).lean();
    if (doc) {
      if (doc.mediaType === 'tv' && update.status != null) {
        return res.status(400).json({ success: false, message: 'Update status on individual episodes for TV' });
      }
      if (doc.mediaType === 'tv' && quality != null) {
        return res.status(400).json({ success: false, message: 'Update episode quality on individual episodes' });
      }
      if (doc.status === 'downloading' || doc.status === 'uploading') {
        return res.status(400).json({
          success: false,
          message: 'Cannot update while downloading or uploading',
        });
      }
      if (update.status === 'pending' && doc.status !== 'failed') {
        return res.status(400).json({ success: false, message: 'Can only reset failed jobs to pending' });
      }
      const updated = await DownloadQueueModel.findByIdAndUpdate(
        req.params.id,
        { $set: update },
        { new: true }
      ).lean();
      return res.json({ success: true, data: updated });
    }

    doc = await DownloadSeriesQueueModel.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Queue item not found' });
    if (doc.status === 'downloading' || doc.status === 'uploading') {
      return res.status(400).json({
        success: false,
        message: 'Cannot update while downloading or uploading',
      });
    }
    if (update.status === 'pending' && doc.status !== 'failed') {
      return res.status(400).json({ success: false, message: 'Can only reset failed jobs to pending' });
    }
    const updated = await DownloadSeriesQueueModel.findByIdAndUpdate(
      req.params.id,
      { $set: update },
      { new: true }
    ).lean();
    return res.json({ success: true, data: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// DELETE /:id — Remove item (movie, TV parent + all episodes, or single episode).
// -----------------------------------------------------------------------------

router.delete('/:id', validateToken, validateAdmin, async (req, res) => {
  try {
    let doc = await DownloadQueueModel.findById(req.params.id).lean();
    if (doc) {
      if (doc.mediaType === 'tv') {
        const anyInProgress = await DownloadSeriesQueueModel.findOne({
          parentId: doc._id,
          status: { $in: ['downloading', 'uploading'] },
        }).lean();
        if (anyInProgress) {
          return res.status(400).json({
            success: false,
            message: 'Cannot delete show while an episode is downloading or uploading',
          });
        }
        await DownloadSeriesQueueModel.deleteMany({ parentId: doc._id });
        await DownloadQueueModel.deleteOne({ _id: doc._id });
        return res.json({ success: true, data: doc });
      }
      if (doc.status === 'downloading' || doc.status === 'uploading') {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete while downloading or uploading',
        });
      }
      await DownloadQueueModel.deleteOne({ _id: doc._id });
      return res.json({ success: true, data: doc });
    }

    doc = await DownloadSeriesQueueModel.findById(req.params.id).lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Queue item not found' });
    if (doc.status === 'downloading' || doc.status === 'uploading') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete while downloading or uploading',
      });
    }
    await DownloadSeriesQueueModel.deleteOne({ _id: doc._id });
    return res.json({ success: true, data: doc });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// GET /job/:jobId — Get single job by jobId (movie or episode)
// -----------------------------------------------------------------------------

router.get('/job/:jobId', validateToken, validateAdmin, async (req, res) => {
  try {
    let doc = await DownloadQueueModel.findOne({ jobId: req.params.jobId }).lean();
    if (doc) {
      const data = { ...doc, poster_url: getPosterUrl(doc.poster_path, 'w200') || null };
      return res.json({ success: true, data });
    }
    doc = await DownloadSeriesQueueModel.findOne({ jobId: req.params.jobId })
      .populate('parentId', 'tmdbId poster_path title')
      .lean();
    if (!doc) return res.status(404).json({ success: false, message: 'Job not found' });
    const parent = doc.parentId || {};
    const data = {
      ...doc,
      poster_url: getPosterUrl(parent.poster_path, 'w200') || null,
      poster_path: parent.poster_path,
      tmdbId: parent.tmdbId,
    };
    return res.json({ success: true, data });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /process — Move pending → waiting (assign jobId).
// Query/body: type = 'both' | 'movie' | 'tv' (default both). movie = movies only, tv = series episodes only.
// -----------------------------------------------------------------------------

router.post('/process', validateToken, validateAdmin, async (req, res) => {
  try {
    const type = (req.query.type || req.body?.type || 'both').toLowerCase();
    const doMovies = type === 'both' || type === 'movie';
    const doTv = type === 'both' || type === 'tv';

    let movedMovies = 0;
    if (doMovies) {
      const pendingMovies = await DownloadQueueModel.find({
        mediaType: 'movie',
        status: 'pending',
      })
        .sort({ createdAt: 1 })
        .lean();
      for (const doc of pendingMovies) {
        await DownloadQueueModel.updateOne(
          { _id: doc._id },
          { $set: { status: 'waiting', jobId: doc._id.toString() } }
        );
        movedMovies += 1;
      }
    }

    let movedEpisodes = 0;
    if (doTv) {
      const pendingEpisodes = await DownloadSeriesQueueModel.find({ status: 'pending' })
        .sort({ createdAt: 1 })
        .lean();
      for (const doc of pendingEpisodes) {
        await DownloadSeriesQueueModel.updateOne(
          { _id: doc._id },
          { $set: { status: 'waiting', jobId: doc._id.toString() } }
        );
        movedEpisodes += 1;
      }
    }

    const moved = movedMovies + movedEpisodes;
    return res.json({
      success: true,
      data: { moved, movedMovies, movedEpisodes },
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// -----------------------------------------------------------------------------
// POST /process/start — Ping sniffer server to start its worker loop (loop runs in Python).
// -----------------------------------------------------------------------------

router.post('/process/start', validateToken, validateAdmin, async (req, res) => {
  try {
    if (!SNIFFER_URL) {
      return res.status(503).json({ success: false, message: 'SNIFFER_URL not set' });
    }
    const { data, status } = await axios.get(
      `${SNIFFER_URL}/download`,
      { timeout: 5000, validateStatus: () => true }
    );
    if (status === 503) {
      return res.status(503).json({ success: false, message: data?.message || 'Sniffer loop already running' });
    }
    return res.json({ success: true, message: data?.message || 'Started', data: null });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});



module.exports = router;
