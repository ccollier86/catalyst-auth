import { mkdir, readdir, readFile, lstat, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const packagesDir = path.join(repoRoot, 'packages');
const nodeModulesDir = path.join(repoRoot, 'node_modules');

const pathExists = async (candidate) => {
  try {
    await lstat(candidate);
    return true;
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

const ensureLink = async (packageName, targetDir) => {
  const segments = packageName.split('/');
  const packageDir = path.join(nodeModulesDir, ...segments.slice(0, -1));
  const linkPath = path.join(nodeModulesDir, ...segments);
  await mkdir(packageDir, { recursive: true });
  if (await pathExists(linkPath)) {
    await rm(linkPath, { recursive: true, force: true });
  }
  await symlink(targetDir, linkPath, 'dir');
};

const main = async () => {
  await mkdir(nodeModulesDir, { recursive: true });
  const entries = await readdir(packagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const packageJsonPath = path.join(packagesDir, entry.name, 'package.json');
    if (!(await pathExists(packageJsonPath))) {
      continue;
    }
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'));
    const packageName = packageJson.name;
    if (typeof packageName !== 'string' || packageName.length === 0) {
      continue;
    }
    const distDir = path.join(packagesDir, entry.name, 'dist');
    if (!(await pathExists(distDir))) {
      continue;
    }
    await ensureLink(packageName, distDir);
  }
};

main().catch((error) => {
  console.error('Failed to link workspace packages', error);
  process.exitCode = 1;
});
