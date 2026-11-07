import childProcess from 'node:child_process';

// Bun 1.3.14 closes the pipe fds of a finished child process a second
// time when it collects the ChildProcess object. By then a newer child,
// such as the next browser, can have the same fd numbers: its pipe to
// Playwright closes and the run waits for ever. Under such a Bun, every
// child is held here, so it is never collected. That is a few objects
// for each browser start. Bun 1.4.4 does not have the fault
// (https://github.com/oven-sh/bun/issues/47956), and Node.js never had
// it.

// True for a Bun version older than 1.4.4; false for none (Node.js).
export function holdNeeded(bun) {
  if (!bun) return false;
  const [major, minor, patch] = bun.split('.').map((n) => parseInt(n, 10) || 0);
  return major < 1 || (major === 1 && (minor < 4 || (minor === 4 && patch < 4)));
}

if (holdNeeded(process.versions.bun)) {
  const held = new Set();
  const spawn = childProcess.spawn;
  childProcess.spawn = function (...args) {
    const child = spawn.apply(this, args);
    held.add(child);
    return child;
  };
}
