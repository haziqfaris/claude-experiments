import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { GitInfo } from '../src/types';

const cache = new Map<string, { at: number; info: GitInfo | null }>();
const TTL_MS = 20_000;

function git(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 3000, maxBuffer: 1024 * 1024 }, (err, stdout) =>
      resolve(err ? null : stdout),
    );
  });
}

export async function gitInfo(cwd: string): Promise<GitInfo | null> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.info;
  let info: GitInfo | null = null;
  const branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch != null) {
    const [status, log] = await Promise.all([
      git(cwd, ['status', '--porcelain=v1']),
      git(cwd, ['log', '-8', '--pretty=format:%h%x09%s%x09%cr']),
    ]);
    info = {
      branch: branch.trim() || null,
      dirty: (status ?? '').split('\n').filter(Boolean).slice(0, 25),
      commits: (log ?? '')
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [hash, subject, when] = l.split('\t');
          return { hash, subject, when };
        }),
    };
  }
  cache.set(cwd, { at: Date.now(), info });
  return info;
}

/** The first part of CLAUDE.md or README.md, so answers know what the project is. */
export async function projectNotes(cwd: string): Promise<{ file: string; excerpt: string } | null> {
  for (const name of ['CLAUDE.md', 'README.md', 'readme.md']) {
    try {
      const text = await fs.readFile(path.join(cwd, name), 'utf8');
      return { file: name, excerpt: text.slice(0, 1500) };
    } catch {
      /* try the next one */
    }
  }
  return null;
}
