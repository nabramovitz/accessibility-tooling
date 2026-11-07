import childProcess from 'node:child_process';

// Bun 1.3.14 closes the pipe fds of a finished child process a second
// time when it collects the ChildProcess object. By then a newer child,
// such as the next browser, can have the same fd numbers: its pipe to
// Playwright closes and the run waits for ever. Under Bun, every child
// is held here, so it is never collected. That is a few objects for each
// browser start. Node.js does not need this.
if (process.versions.bun) {
  const held = new Set();
  const spawn = childProcess.spawn;
  childProcess.spawn = function (...args) {
    const child = spawn.apply(this, args);
    held.add(child);
    return child;
  };
}
