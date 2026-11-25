import * as esbuild from 'esbuild';
import { watch as fsWatch } from 'node:fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { generateIcons } from './icons.ts';

const watchMode = process.argv.includes('--watch');
const releaseMode = process.argv.includes('--release');
const storeMode = process.argv.includes('--store');
const outDir = 'dist';

const STATIC_ASSETS: readonly (readonly [src: string, dest: string])[] = [
  ['src/pages/popup/popup.html', `${outDir}/popup.html`],
  ['src/pages/popup/popup.css', `${outDir}/popup.css`],
  ['src/pages/options/options.html', `${outDir}/options.html`],
  ['src/pages/options/options.css', `${outDir}/options.css`],
  ['src/pages/shared/ui.css', `${outDir}/ui.css`],
];

async function writeManifest(): Promise<void> {
  const [pkgRaw, manifestRaw] = await Promise.all([
    readFile('package.json', 'utf8'),
    readFile('src/static/manifest.json', 'utf8'),
  ]);

  const pkg = JSON.parse(pkgRaw) as { version: string };
  const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
  manifest.version = pkg.version;

  if (storeMode) {
    delete manifest.key;
    delete manifest.update_url;
  }

  await writeFile(`${outDir}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyStaticAssets(): Promise<void> {
  await Promise.all([
    writeManifest(),
    ...STATIC_ASSETS.map(([src, dest]) => copyFile(src, dest)),
  ]);
}

function watchStaticAssets(): void {
  const watchedFiles = [
    ...STATIC_ASSETS.map(([src, dest]) => ({ src, sync: () => copyFile(src, dest) })),
    { src: 'src/static/manifest.json', sync: writeManifest },
    { src: 'package.json', sync: writeManifest },
  ];

  for (const entry of watchedFiles) {
    fsWatch(entry.src, () => {
      void entry.sync().catch((err: unknown) => console.error(`[build] failed syncing ${entry.src}`, err));
    });
  }
}

await rm(outDir, { recursive: true, force: true });
await mkdir(`${outDir}/icons`, { recursive: true });
await Promise.all([copyStaticAssets(), generateIcons(`${outDir}/icons`)]);

const common: esbuild.BuildOptions = {
  bundle: true,
  target: 'chrome120',
  sourcemap: releaseMode ? false : 'inline',
  minify: releaseMode,
  logLevel: 'info',
};

const contexts = await Promise.all([
  esbuild.context({
    ...common,
    format: 'esm',
    entryPoints: {
      background: 'src/background/index.ts',
      popup: 'src/pages/popup/popup.ts',
      options: 'src/pages/options/options.ts',
    },
    outdir: outDir,
  }),
  esbuild.context({
    ...common,
    format: 'iife',
    entryPoints: { content: 'src/content/index.ts' },
    outdir: outDir,
  }),
]);

if (watchMode) {
  watchStaticAssets();
  await Promise.all(contexts.map((c) => c.watch()));
} else {
  await Promise.all(contexts.map((c) => c.rebuild()));
  await Promise.all(contexts.map((c) => c.dispose()));
}
