#!/usr/bin/env node

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';

const rootDir = process.cwd();
const frontendDir = path.join(rootDir, 'frontend');
const tmpDir = path.join(rootDir, '.tmp', 'ci');
const isWindows = process.platform === 'win32';

mkdirSync(tmpDir, { recursive: true });
mkdirSync(path.join(rootDir, 'build', 'bin'), { recursive: true });

function logStep(message) {
  process.stdout.write(`\n==> ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function quoteWindowsArg(value) {
  if (value.length === 0) {
    return '""';
  }

  if (!/[\s"]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1')}"`;
}

function resolveSpawnTarget(command, args) {
  if (!isWindows || !/\.(cmd|bat)$/i.test(command)) {
    return {
      file: command,
      args,
    };
  }

  const comspec = process.env.ComSpec || 'cmd.exe';
  const commandLine = [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ');

  return {
    file: comspec,
    args: ['/d', '/s', '/c', commandLine],
  };
}

function run(command, args, options = {}) {
  const {
    cwd = rootDir,
    env = {},
    retries = 0,
    retryDelayMs = 2000,
    timeoutMs = 0,
  } = options;

  return new Promise((resolve, reject) => {
    let attempt = 0;

    const runOnce = () => {
      attempt += 1;
      const target = resolveSpawnTarget(command, args);
      const child = spawn(target.file, target.args, {
        cwd,
        env: {
          ...process.env,
          CI: 'true',
          ...env,
        },
        stdio: 'inherit',
        shell: false,
      });

      let timeoutId = null;
      if (timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          process.stderr.write(
            `\nCommand timed out after ${timeoutMs}ms: ${command} ${args.join(' ')}\n`,
          );
          child.kill('SIGKILL');
        }, timeoutMs);
      }

      child.on('error', reject);
      child.on('exit', async (code) => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        if (code === 0) {
          resolve();
          return;
        }
        if (attempt <= retries) {
          process.stdout.write(
            `\nCommand failed with exit code ${code}. Retrying ${attempt}/${retries}...\n`,
          );
          await sleep(retryDelayMs);
          runOnce();
          return;
        }
        reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
      });
    };

    runOnce();
  });
}

async function runFrontendBuild() {
  logStep('Build frontend');
  await run(isWindows ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: frontendDir,
  });
}

async function runGoTests() {
  logStep('Run backend tests');
  const env = isWindows
    ? {
        GOTMPDIR: path.join(tmpDir, 'go-tmp'),
        GOCACHE: path.join(tmpDir, 'go-cache'),
      }
    : {};

  if (isWindows) {
    mkdirSync(env.GOTMPDIR, { recursive: true });
    mkdirSync(env.GOCACHE, { recursive: true });
  }

  await run('go', ['test', '-count=1', './...'], {
    env,
    retries: isWindows ? 2 : 0,
    retryDelayMs: 3000,
  });
}

async function runFrontendTypecheck() {
  logStep('Run frontend typecheck');
  await run(isWindows ? 'npm.cmd' : 'npm', ['run', 'typecheck'], {
    cwd: frontendDir,
  });
}

async function runFrontendTests() {
  logStep('Run frontend tests');
  await run(isWindows ? 'npm.cmd' : 'npm', ['test'], {
    cwd: frontendDir,
    retries: 1,
    retryDelayMs: 3000,
    timeoutMs: 5 * 60 * 1000,
  });
}

async function buildBinary() {
  logStep('Build Go binary');
  const output = isWindows
    ? path.join('build', 'bin', 'pinru.exe')
    : path.join('build', 'bin', 'pinru');
  await run('go', ['build', '-o', output, '.']);
}

async function main() {
  const mode = process.argv[2] ?? 'ci';

  if (mode !== 'ci') {
    throw new Error(`unsupported mode: ${mode}`);
  }

  await runFrontendBuild();
  await runGoTests();
  await runFrontendTypecheck();
  await runFrontendTests();
  await buildBinary();
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
