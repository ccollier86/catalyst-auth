import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const tsconfigPath = resolve(__dirname, '..', 'tsconfig.base.json');

const raw = await fs.readFile(tsconfigPath, 'utf8');
const json = JSON.parse(raw);
const compilerOptions = json.compilerOptions ?? {};
const { paths = {} } = compilerOptions;

const sortedEntries = Object.entries(paths)
  .map(([alias, targetPaths]) => [alias, [...targetPaths].sort((a, b) => a.localeCompare(b))])
  .sort(([a], [b]) => a.localeCompare(b));

compilerOptions.paths = Object.fromEntries(sortedEntries);

const optionKeys = Object.keys(compilerOptions).filter((key) => key !== 'paths');

const lines = ['{', '  "compilerOptions": {'];

for (const key of optionKeys) {
  const value = compilerOptions[key];
  const serialized = JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `    ${line}`))
    .join('\n');
  lines.push(`    "${key}": ${serialized},`);
}

lines.push('    "paths": {');

sortedEntries.forEach(([alias, targetPaths], index) => {
  const pathLines = targetPaths.map((target) => `        "${target}"`);
  const entryLines = [
    `      "${alias}": [`,
    ...pathLines.map((line) => `${line}`),
    '      ]'
  ];
  const suffix = index === sortedEntries.length - 1 ? '' : ',';
  entryLines[entryLines.length - 1] = `${entryLines[entryLines.length - 1]}${suffix}`;
  lines.push(...entryLines);
});

lines.push('    }');
lines.push('  },');

if ('exclude' in json) {
  const excludeSerialized = JSON.stringify(json.exclude, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join('\n');
  lines.push(`  "exclude": ${excludeSerialized}`);
}

lines.push('}');
lines.push('');

await fs.writeFile(tsconfigPath, lines.join('\n'));
