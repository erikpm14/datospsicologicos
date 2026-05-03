const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

const orig = {
  spawn: childProcess.spawn,
  exec: childProcess.exec,
  execFile: childProcess.execFile,
  fork: childProcess.fork,
  spawnSync: childProcess.spawnSync,
  execSync: childProcess.execSync,
  execFileSync: childProcess.execFileSync,
};

function isChildProcessDebugEnabled() {
  return String(process.env.CHILD_PROCESS_DEBUG || 'false') === 'true';
}

function withDefaults(options = {}) {
  return {
    windowsHide: true,
    shell: false,
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  };
}

function normalizeCommand(command) {
  if (process.platform !== 'win32') return command;
  const cmd = String(command || '');
  const lower = cmd.toLowerCase();

  if (lower === 'python' || lower === 'python3' || lower === 'py') return 'pythonw';

  if (lower.endsWith('python.exe')) {
    const dir = path.dirname(cmd);
    const candidate = path.join(dir, 'pythonw.exe');
    if (fs.existsSync(candidate)) return candidate;
    return 'pythonw';
  }

  return command;
}

childProcess.spawn = (command, args = [], options = {}) => {
  const cmd = normalizeCommand(command);
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', cmd, args);
  return orig.spawn(cmd, args, withDefaults(options));
};

childProcess.execFile = (file, args = [], options = {}, callback) => {
  const f = normalizeCommand(file);
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', f, args);
  return orig.execFile(f, args, withDefaults(options), callback);
};

childProcess.spawnSync = (command, args = [], options = {}) => {
  const cmd = normalizeCommand(command);
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', cmd, args);
  return orig.spawnSync(cmd, args, withDefaults(options));
};

childProcess.execFileSync = (file, args = [], options = {}) => {
  const f = normalizeCommand(file);
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', f, args);
  return orig.execFileSync(f, args, withDefaults(options));
};

childProcess.exec = (command, options, callback) => {
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', command, []);
  return orig.exec(command, { windowsHide: true, ...options }, callback);
};

childProcess.execSync = (command, options = {}) => {
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', command, []);
  return orig.execSync(command, { windowsHide: true, ...options });
};

childProcess.fork = (modulePath, args = [], options = {}) => {
  if (isChildProcessDebugEnabled()) console.log('[SPAWN_DEBUG]', modulePath, args);
  return orig.fork(modulePath, args, { windowsHide: true, ...options });
};

module.exports = { orig };
