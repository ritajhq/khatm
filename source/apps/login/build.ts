import * as esbuild from 'esbuild'

/**
 * Builds the hosted pages into `dist/`: one script, one stylesheet and the
 * HTML template the worker fills in per request. Plain esbuild and Tailwind,
 * so it needs nothing from Ensemble to run.
 */
const dist = new URL('./dist/', import.meta.url).pathname
await Deno.mkdir(dist, { recursive: true })

const result = await esbuild.build({
  // Workspace packages by path; npm packages resolve from node_modules,
  // which Deno fills in because the workspace sets nodeModulesDir.
  alias: {
    '@khatm/pages':
      new URL('../../core/pages/index.ts', import.meta.url).pathname,
    '@khatm/spec':
      new URL('../../core/spec/index.ts', import.meta.url).pathname,
  },
  entryPoints: [new URL('./src/main.tsx', import.meta.url).pathname],
  outfile: `${dist}main.js`,
  bundle: true,
  format: 'esm',
  minify: true,
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
})
await esbuild.stop()
if (result.errors.length > 0) Deno.exit(1)

const css = await new Deno.Command(Deno.execPath(), {
  args: [
    'run',
    '-A',
    'npm:@tailwindcss/cli@4.1.13',
    '-i',
    new URL('./src/index.css', import.meta.url).pathname,
    '-o',
    `${dist}main.css`,
    '--minify',
  ],
  cwd: new URL('.', import.meta.url).pathname,
  stdout: 'inherit',
  stderr: 'inherit',
}).output()
if (!css.success) Deno.exit(1)

await Deno.copyFile(
  new URL('./src/index.html', import.meta.url).pathname,
  `${dist}index.html`,
)
console.log(`Built ${dist}`)
