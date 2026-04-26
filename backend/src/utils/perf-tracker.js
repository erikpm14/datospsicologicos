function createPerfTracker(label, meta = {}) {
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const phases = [];
  let activePhase = null;

  function closeActive(status = 'completed', extra = {}) {
    if (!activePhase) return null;
    const endedMs = Date.now();
    const phase = {
      ...activePhase,
      status,
      endedAt: new Date().toISOString(),
      durationMs: endedMs - activePhase.startedMs,
      ...extra,
    };
    delete phase.startedMs;
    phases.push(phase);
    activePhase = null;
    return phase;
  }

  return {
    start(name, meta = {}) {
      closeActive();
      activePhase = {
        name,
        startedAt: new Date().toISOString(),
        startedMs: Date.now(),
        ...meta,
      };
    },
    end(extra = {}) {
      return closeActive('completed', extra);
    },
    fail(error, extra = {}) {
      return closeActive('failed', {
        error: error?.message || String(error),
        ...extra,
      });
    },
    snapshot(extra = {}) {
      return {
        label,
        startedAt,
        totalMs: Date.now() - startedMs,
        phases: [...phases],
        activePhase: activePhase
          ? {
              ...activePhase,
              durationMs: Date.now() - activePhase.startedMs,
            }
          : null,
        ...meta,
        ...extra,
      };
    },
  };
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms)) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(2);
  return `${seconds}s`;
}

module.exports = { createPerfTracker, formatDurationMs };
