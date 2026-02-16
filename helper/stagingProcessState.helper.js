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
 * @returns {{
 *   isProcessing: boolean,
 *   startedAt: string|null,
 *   total: number,
 *   processed: number,
 *   failed: number,
 *   currentStagingId: string|null,
 *   items: Array<{ stagingId: string, title: string, filename: string }>
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
  };
}

module.exports = {
  tryStartRun,
  updateProgress,
  endRun,
  getState,
};
