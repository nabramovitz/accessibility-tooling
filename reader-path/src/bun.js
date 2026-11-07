import { spawnSync } from 'node:child_process';

// The command that starts Bun, as [file, ...first arguments], when
// `bun --version` works; else null. A bun on the PATH that does not run,
// such as a version manager shim with no version set, counts as none.
// No shell is used. On Windows, bun.exe is found as `bun`; for bun.cmd
// (as npm installs it) the command is cmd.exe, as Node.js does not start
// a .cmd file without it.
export function findBun() {
  const works = (command) => spawnSync(command[0], [...command.slice(1), '--version'],
    { stdio: 'ignore', shell: false, windowsHide: true });
  const bun = ['bun'];
  const r = works(bun);
  if (r.status === 0) return bun;
  if (process.platform === 'win32' && r.error?.code === 'ENOENT') {
    const cmd = [process.env.ComSpec || 'cmd.exe', '/d', '/c', 'bun'];
    if (works(cmd).status === 0) return cmd;
  }
  return null;
}
