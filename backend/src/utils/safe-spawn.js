const { spawn, execFile, spawnSync, execFileSync, execSync, fork } = require('child_process');

const DEFAULT_PROCESS_OPTS = {
  windowsHide: true,
  shell: false,
  detached: false,
  stdio: ['ignore', 'pipe', 'pipe'],
};

function isChildProcessDebugEnabled() {
  return String(process.env.CHILD_PROCESS_DEBUG || 'false') === 'true';
}

function safeSpawn(cmd, args = [], opts = {}) {
  if (process.platform === 'win32') {
    const c = String(cmd || '').toLowerCase();
    if (c === 'python' || c === 'python3' || c === 'py') cmd = 'pythonw';
    if (c.endsWith('python.exe')) cmd = cmd.replace(/python\.exe$/i, 'pythonw.exe');
  }
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', cmd, args);
  return spawn(cmd, args, {
    ...DEFAULT_PROCESS_OPTS,
    ...opts,
    stdio: opts.stdio ?? DEFAULT_PROCESS_OPTS.stdio,
    detached: opts.detached ?? DEFAULT_PROCESS_OPTS.detached,
  });
}

function safeExecFile(file, args = [], opts = {}, cb) {
  if (process.platform === 'win32') {
    const f = String(file || '').toLowerCase();
    if (f === 'python' || f === 'python3' || f === 'py') file = 'pythonw';
    if (f.endsWith('python.exe')) file = file.replace(/python\.exe$/i, 'pythonw.exe');
  }
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', file, args);
  return execFile(
    file,
    args,
    {
      ...DEFAULT_PROCESS_OPTS,
      ...opts,
      stdio: opts.stdio ?? DEFAULT_PROCESS_OPTS.stdio,
      detached: opts.detached ?? DEFAULT_PROCESS_OPTS.detached,
    },
    cb,
  );
}

function safeSpawnSync(cmd, args = [], opts = {}) {
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', cmd, args);
  return spawnSync(cmd, args, {
    ...DEFAULT_PROCESS_OPTS,
    ...opts,
    stdio: opts.stdio ?? DEFAULT_PROCESS_OPTS.stdio,
    detached: opts.detached ?? DEFAULT_PROCESS_OPTS.detached,
  });
}

function safeExecFileSync(file, args = [], opts = {}) {
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', file, args);
  return execFileSync(file, args, {
    ...DEFAULT_PROCESS_OPTS,
    ...opts,
    stdio: opts.stdio ?? DEFAULT_PROCESS_OPTS.stdio,
    detached: opts.detached ?? DEFAULT_PROCESS_OPTS.detached,
  });
}

function debugExec(command, opts, cb) {
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', command, []);
  return require('child_process').exec(command, opts, cb);
}

function debugExecSync(command, opts = {}) {
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', command, []);
  return execSync(command, { windowsHide: true, ...opts });
}

function debugFork(modulePath, args = [], opts = {}) {
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', modulePath, args);
  return fork(modulePath, args, { windowsHide: true, ...opts });
}

module.exports = {
  DEFAULT_PROCESS_OPTS,
  safeSpawn,
  safeExecFile,
  safeSpawnSync,
  safeExecFileSync,
  debugExec,
  debugExecSync,
  debugFork,
};
