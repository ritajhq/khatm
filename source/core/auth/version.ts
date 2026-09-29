/** The installed Better Auth version, read from its package.json. */
export function betterAuthVersion(): string {
  let dir = new URL('.', import.meta.resolve('better-auth'))
  for (let depth = 0; depth < 8; depth++) {
    try {
      const pkg = JSON.parse(
        Deno.readTextFileSync(new URL('package.json', dir)),
      )
      if (pkg.name === 'better-auth') return pkg.version
    } catch {
      // Not here; look one level up.
    }
    dir = new URL('../', dir)
  }
  throw new Error("Can't find the installed better-auth package.json")
}
