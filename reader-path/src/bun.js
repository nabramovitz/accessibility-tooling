import { spawnSync } from 'node:child_process';

const ARG = 'READER_PATH_BUN_ARG';

// How to start Bun with these arguments, as { file, args, options } for
// spawnSync. route 'bun' starts bun (bun.exe on Windows) with no shell.
// route 'cmd' starts bun.cmd, as npm installs it on Windows: Node.js
// does not start a .cmd file without cmd.exe. cmd.exe reads one command
// line, where & | < > ^ and %name% have a meaning, so each argument goes
// in a variable. cmd expands each variable once, inside quotes, after
// it has read the line; the value is then not read again.
export function bunCommand(route, args, env = process.env) {
  if (route === 'bun') return { file: 'bun', args, options: { env } };
  const vars = {};
  const words = args.map((a, i) => { vars[`${ARG}${i}`] = a; return `"%${ARG}${i}%"`; });
  const comspec = Object.keys(env).find((k) => k.toUpperCase() === 'COMSPEC');
  return {
    file: (comspec && env[comspec]) || 'cmd.exe',
    args: ['/d', '/s', '/c', `"bun ${words.join(' ')}"`],
    options: { env: { ...env, ...vars }, windowsVerbatimArguments: true },
  };
}

// Starts Bun on a route with these arguments; options go to spawnSync.
export function runBun(route, args, options = {}) {
  const c = bunCommand(route, args, options.env || process.env);
  return spawnSync(c.file, c.args, { shell: false, windowsHide: true, ...options, ...c.options });
}

// The route to a Bun for which `bun --version` works, else null. A bun
// on the PATH that does not run, such as a version manager shim with no
// version set, counts as none. On Windows, bun.exe is found first; the
// current directory is searched before the PATH.
export function findBun() {
  const r = runBun('bun', ['--version'], { stdio: 'ignore' });
  if (r.status === 0) return 'bun';
  if (process.platform === 'win32' && r.error?.code === 'ENOENT'
    && runBun('cmd', ['--version'], { stdio: 'ignore' }).status === 0) return 'cmd';
  return null;
}
