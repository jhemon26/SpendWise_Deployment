import { writeFileSync, mkdirSync } from 'node:fs';
// Node decides ESM-vs-CJS per directory from the nearest package.json "type".
// Without these markers the dual build is ambiguous and Node guesses wrong.
for (const [dir, type] of [['dist/cjs', 'commonjs'], ['dist/esm', 'module']]) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/package.json`, JSON.stringify({ type }, null, 2) + '\n');
}
console.log('wrote dist/cjs and dist/esm type markers');
