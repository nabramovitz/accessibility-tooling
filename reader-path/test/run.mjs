// Runs the tests: `npm test` and `bun run test` start this file. The
// command comes from command.js; the exit code passes through. No shell
// is used, so it works the same from cmd, PowerShell and sh.
import { spawnSync } from 'node:child_process';
import { ROOT, testCommand } from './command.js';

const [file, ...args] = testCommand();
const r = spawnSync(file, args, { stdio: 'inherit', cwd: ROOT });
if (r.error) {
  console.error(`test: ${r.error.message}`);
  process.exit(1);
}
if (r.signal) process.kill(process.pid, r.signal);
process.exit(r.status ?? 1);
