import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const tasks = [
  ['API', ['run', 'dev:api']],
  ['Web', ['run', 'dev:web']],
];
const children = tasks.map(([label, args]) => {
  const child = spawn(npm, args, { cwd: process.cwd(), stdio: 'inherit', env: process.env });
  child.on('error', (error) => {
    console.error(`[${label}] não iniciou: ${error.message}`);
    stop(1);
  });
  child.on('exit', (code) => {
    if (code && code !== 0) stop(code);
  });
  return child;
});

let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
  process.exitCode = code;
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
