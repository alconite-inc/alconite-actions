import { readFile, stat } from 'node:fs/promises';

const reviewedDirectDependencies = new Map([
  ['@apidevtools/swagger-parser', 'MIT'],
  ['ajv', 'MIT'],
  ['ajv-formats', 'MIT'],
  ['ignore', 'MIT'],
  ['yaml', 'ISC']
]);

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
for (const [name, expectedLicense] of reviewedDirectDependencies) {
  const entry = lock.packages?.[`node_modules/${name}`];
  if (!entry || entry.license !== expectedLicense) {
    throw new Error(`${name} must be locked with the reviewed ${expectedLicense} license`);
  }
}

const allowedLicenses = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', 'Python-2.0']);
const rootDependencies = Object.keys(lock.packages?.['']?.dependencies ?? {});
const pending = [...rootDependencies];
const reviewedPackages = new Set();
while (pending.length > 0) {
  const name = pending.pop();
  if (!name || reviewedPackages.has(name)) continue;
  reviewedPackages.add(name);
  const entry = lock.packages?.[`node_modules/${name}`];
  if (!entry || !allowedLicenses.has(entry.license)) {
    throw new Error(`${name} has an unreviewed or missing runtime license: ${entry?.license ?? 'missing'}`);
  }
  pending.push(...Object.keys(entry.dependencies ?? {}));
}

const bundle = await stat('runtime-verify/dist/index.js').catch(() => undefined);
if (bundle && bundle.size > 5 * 1024 * 1024) {
  throw new Error(`Runtime Verify bundle is unexpectedly large: ${bundle.size} bytes`);
}

const impactBundle = await stat('impact/dist/index.js').catch(() => undefined);
if (impactBundle && impactBundle.size > 2 * 1024 * 1024) {
  throw new Error(`Impact bundle is unexpectedly large: ${impactBundle.size} bytes`);
}

console.log(`Reviewed ${reviewedPackages.size} bundled runtime dependency licenses; component bundle sizes are within policy.`);
