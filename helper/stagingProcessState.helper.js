/**
 * In-memory state for the staging process queue. One process run at a time (semaphore).
 * Survives until server restart; frontend can poll GET /api/staging/process-status.
 */

let state = {
  isProcessing: false,
  startedAt: null,
  total: 0,
  processed: 0,
  failed: 0,
  currentStagingId: null,
  /** Snapshot of items in this run: { stagingId, title, filename } */
  items: [],
};

/**
 * State for "upload to staging" (chunked upload → write to staging).
 * Frontend can poll GET /api/staging/process-status and read data.upload.
 */
let uploadState = {
  active: false,
  uploadId: null,
  status: null, // 'uploading' | 'writing' | 'done' | 'error'
  startedAt: null,
  fileName: null,
  totalChunks: 0,
  currentChunk: 0,
  uploadProgress: null, // 0–100 sending chunks
  dbProgress: null, // 0–100 writing to DB
  error: null,
  stagingId: null, // set when done
};

/**
 * Try to start a run. Returns false if already processing (caller should respond 409).
 * @param {Array<{ _id: object, title?: string, filename: string }>} pendingDocs - pending staging docs (snapshot for display)
 * @returns {boolean}
 */
function tryStartRun(pendingDocs) {
  if (state.isProcessing) return false;
  state.isProcessing = true;
  state.startedAt = new Date();
  state.total = pendingDocs.length;
  state.processed = 0;
  state.failed = 0;
  state.currentStagingId = null;
  state.items = pendingDocs.map((d) => ({
    stagingId: d._id.toString(),
    title: d.title ?? '',
    filename: d.filename ?? '',
  }));
  return true;
}

/**
 * Update progress during the run.
 * @param {number} processed
 * @param {number} failed
 * @param {string|null} currentStagingId - id of item currently being uploaded, or null
 */
function updateProgress(processed, failed, currentStagingId) {
  state.processed = processed;
  state.failed = failed;
  state.currentStagingId = currentStagingId;
}

/**
 * Release the lock and clear current run (call in finally).
 */
function endRun() {
  state.isProcessing = false;
  state.currentStagingId = null;
  // Keep items, total, processed, failed, startedAt so UI can show "last run" until next start
}

/**
 * Set state for upload-to-staging (chunked upload). Merges partial into uploadState.
 * @param {Partial<{ uploadId: string, status: string, fileName: string, totalChunks: number, currentChunk: number, uploadProgress: number, dbProgress: number, error: string, stagingId: string }>} partial
 */
function setUploadState(partial) {
  if (!partial) return;
  if (partial.uploadId != null) uploadState.uploadId = partial.uploadId;
  if (partial.status != null) uploadState.status = partial.status;
  if (partial.fileName != null) uploadState.fileName = partial.fileName;
  if (partial.totalChunks != null) uploadState.totalChunks = partial.totalChunks;
  if (partial.currentChunk != null) uploadState.currentChunk = partial.currentChunk;
  if (partial.uploadProgress != null) uploadState.uploadProgress = partial.uploadProgress;
  if (partial.dbProgress != null) uploadState.dbProgress = partial.dbProgress;
  if (partial.error != null) uploadState.error = partial.error;
  if (partial.stagingId != null) uploadState.stagingId = partial.stagingId;
  if (partial.status === 'uploading' || partial.status === 'writing') {
    uploadState.active = true;
    if (!uploadState.startedAt) uploadState.startedAt = new Date();
  }
  if (partial.status === 'done' || partial.status === 'error') {
    uploadState.active = false;
  }
}

/**
 * Clear upload-to-staging state (e.g. after client has seen 'done' or on timeout).
 */
function clearUploadState() {
  uploadState.active = false;
  uploadState.uploadId = null;
  uploadState.status = null;
  uploadState.startedAt = null;
  uploadState.fileName = null;
  uploadState.totalChunks = 0;
  uploadState.currentChunk = 0;
  uploadState.uploadProgress = null;
  uploadState.dbProgress = null;
  uploadState.error = null;
  uploadState.stagingId = null;
}

/**
 * @returns {{
 *   active: boolean,
 *   uploadId: string|null,
 *   status: string|null,
 *   startedAt: string|null,
 *   fileName: string|null,
 *   totalChunks: number,
 *   currentChunk: number,
 *   uploadProgress: number|null,
 *   dbProgress: number|null,
 *   error: string|null,
 *   stagingId: string|null
 * }}
 */
function getUploadState() {
  return {
    active: uploadState.active,
    uploadId: uploadState.uploadId,
    status: uploadState.status,
    startedAt: uploadState.startedAt ? uploadState.startedAt.toISOString() : null,
    fileName: uploadState.fileName,
    totalChunks: uploadState.totalChunks,
    currentChunk: uploadState.currentChunk,
    uploadProgress: uploadState.uploadProgress,
    dbProgress: uploadState.dbProgress,
    error: uploadState.error,
    stagingId: uploadState.stagingId,
  };
}

/**
 * @returns {{
 *   isProcessing: boolean,
 *   startedAt: string|null,
 *   total: number,
 *   processed: number,
 *   failed: number,
 *   currentStagingId: string|null,
 *   items: Array<{ stagingId: string, title: string, filename: string }>,
 *   upload: ReturnType<typeof getUploadState>
 * }}
 */
function getState() {
  return {
    isProcessing: state.isProcessing,
    startedAt: state.startedAt ? state.startedAt.toISOString() : null,
    total: state.total,
    processed: state.processed,
    failed: state.failed,
    currentStagingId: state.currentStagingId,
    items: [...state.items],
    upload: getUploadState(),
  };
}

module.exports = {
  tryStartRun,
  updateProgress,
  endRun,
  getState,
  setUploadState,
  clearUploadState,
  getUploadState,
};
