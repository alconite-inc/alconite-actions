import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  absWorkingDir: repositoryRoot,
  entryPoints: [path.join(repositoryRoot, 'src/impact/index.ts')],
  outfile: path.join(repositoryRoot, 'impact/dist/index.js'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  sourcemap: false,
  legalComments: 'eof',
  charset: 'utf8'
});
