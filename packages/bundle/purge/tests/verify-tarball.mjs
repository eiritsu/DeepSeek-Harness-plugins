import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = await mkdtemp(join(tmpdir(), 'dsh-purge-package-'));

try {
  execFileSync('pnpm', ['pack', '--pack-destination', destination], { cwd: packageRoot, stdio: 'pipe' });
  const archives = (await readdir(destination)).filter(file => file.endsWith('.tgz'));
  if (archives.length !== 1 || archives[0] === undefined) throw new Error(`Expected one packed archive; found ${archives.length}`);
  const archive = join(destination, archives[0]);
  const entries = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n'));

  for (const entry of [
    'package/lib/index.js',
    'package/client.js',
    'package/cordis.patch.yml',
    'package/icon.svg',
    'package/package.json',
    'package/README.md',
    'package/README.zh.md',
    'package/README.i18n.yaml',
  ]) {
    if (!entries.has(entry)) throw new Error(`Packed archive is missing ${entry}`);
  }

  const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
  if (manifest.version !== '0.2.2-rc.1') throw new Error(`Expected version 0.2.2-rc.1, got ${manifest.version}`);
  if (manifest.name !== '@deepseek-ai/dsh-purge') throw new Error(`Expected name @deepseek-ai/dsh-purge, got ${manifest.name}`);

  for (const field of ['dependencies', 'peerDependencies']) {
    for (const [dep, version] of Object.entries(manifest[field] || {})) {
      if (typeof version === 'string' && version.includes('workspace:')) {
        throw new Error(`Leaked workspace reference in packed ${field}: ${dep} -> ${version}`);
      }
    }
  }

  const unpacked = join(destination, 'unpacked');
  await mkdir(unpacked);
  execFileSync('tar', ['-xzf', archive, '-C', unpacked]);
  try {
    const leaks = execFileSync('grep', ['-rn', '/Users/', unpacked], { encoding: 'utf8' }).trim();
    if (leaks) throw new Error(`Found leaked host paths in packed archive:\n${leaks}`);
  } catch (err) {
    // grep returns exit code 1 if no matches found
    if (err.status !== 1) throw err;
  }

  process.stdout.write(`Verified ${archives[0]}: all essential assets packed, valid manifest, no workspace leaks, no host path leaks.\n`);
} finally {
  await rm(destination, { recursive: true, force: true });
}
