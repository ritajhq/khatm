# Better Auth Orchestrator — Design Handoff

Sep 28, 2026 · @Ali

## Purpose

We are building a self-hosted, single-tenant auth appliance: an orchestrator that takes a declarative config, builds the `betterAuth()` instance from it, and runs, restarts and manages the auth server process. A CLI and a web console share the same logic to configure it and administer users.

This inverts Better Auth's usual model. Better Auth normally lives inside the app, configured in code. Here it becomes a standalone identity provider (IdP), like a TypeScript-powered Keycloak. Client apps sit on other origins. The first real consumer, the portal, integrates as a set of first-party apps sharing one session cookie, with idhn guards in front of its services (see Applications and consumers). Third-party apps integrating as OAuth/OIDC clients come later, through Better Auth's oauth-provider and JWT plugins. This decision shapes everything else, especially the hosted login UI.

Mental model: a small Kubernetes. The config is a manifest (desired state), the orchestrator is a controller running a reconcile loop, the auth process is a pod, and the CLI is kubectl.

## Decisions already made

The end state: an operator runs `plan` and `apply` against a config, and the running auth server switches to the new behavior without dropping sessions.

| Decision | Choice | Consequence |
| --- | --- | --- |
| Tenancy | Single-tenant deployable unit, not SaaS | One manifest, one live instance, one branding spec |
| Packaging | One container image, orchestrator as PID 1 plus a Better Auth child process | Blue/green works inside the container |
| Interfaces | CLI and web UI, both thin shells over a shared SDK | All logic lives in shared packages |
| Artifacts | Written automatically on every apply | An apply fails if its artifact can't be written |
| Admin scope | The web UI is also the user admin console | New Identity Administration context, with roles and an audit log |
| Language | TypeScript throughout, domain modeling first | Zod schemas are the source of truth |

## Domain model

Five bounded contexts, each with its own lifecycle:

| Context | Owns | Notes |
| --- | --- | --- |
| Configuration | `Manifest`, `Revision`, `AuthSpec`, `Application`, `SessionContract` | Desired state; manifests content-addressed, revisions append-only |
| Runtime | `AuthInstance`, `Deployment` | Actual state: `Starting → Healthy → Draining → Stopped \| Crashed` |
| Control | Plan, apply, rollback, status, logs, export, import | Exposed through the control API |
| Presentation | `BrandingSpec`, hosted pages, email templates | Separate lifecycle; changes applied hot |
| Identity Administration | Users, sessions, accounts, orgs, audit log | Goes through Better Auth's admin plugin |

Type sketch (design level, not final):

```ts
// Content: what the config says. Same content, same digest, whoever wrote it.
type Manifest = {
  auth: AuthSpec;            // serializable, no functions
  branding: BrandingSpec;
};
type ManifestDigest = string; // hash of the canonical serialization of a Manifest

// Event: someone applied a manifest at a point in time.
type Revision = {
  id: RevisionId;            // unique per event, not derived from content
  parent?: RevisionId;       // the revision that was active when this one was planned
  manifest: ManifestDigest;
  createdAt: Date;
  author: OperatorId;
  reason?: string;           // "rollback to r41", "add passkeys"
};

type AuthSpec = {
  baseURL: string;
  secrets: VersionedSecret[]; // Better Auth `secrets`; newest version signs, older ones still verify
  database: DatabaseSpec;
  emailAndPassword?: { enabled: boolean; requireVerification?: boolean };
  socialProviders: Record<ProviderId, { clientId: SecretRef; clientSecret: SecretRef }>;
  plugins: PluginSpec[];     // discriminated union by `kind`
  hooks: CapabilityRef[];    // named references, not code
  applications: Application[];
  session: SessionContract;
};

// Who signs in through this server. First-party apps share the session cookie;
// OAuth apps (later) get tokens through the oauth-provider plugin.
type Application =
  | {
      kind: "first-party";
      id: AppId;                 // "dashboard", "admin"
      origin: string;            // "https://dashboard.ritaj.app"
      landing?: boolean;         // where sign-in goes when no return_to is given
    }
  | {
      kind: "oauth";
      id: AppId;
      redirectUris: string[];
      scopes: string[];
      confidential: boolean;     // client secret delivered once, stored hashed by Better Auth
    };

// What resource servers (idhn guards, backends) rely on to identify a caller.
type SessionContract = {
  cookieDomain?: string;       // shared parent domain; required once any guard sits on another host
  introspectionURL: string;    // internal get-session address guards call, never the public one
  issuer: string;              // "portal"
  claims: string[];            // user fields exposed: ["username", "email", "name", "emailVerified", "role"]
};

type SecretRef = { env: string } | { file: string };
type VersionedSecret = { version: number; value: SecretRef };

type ChangeImpact = "hot" | "restart" | "migration" | "manual" | "destructive";
type PlanStep = { path: string; before: unknown; after: unknown; impact: ChangeImpact };

type Deployment = {
  activeRevision: RevisionId;
  configSource: "file" | "console" | "file-then-console";
  instance: AuthInstance;    // one live, plus one transient during rollout
};
```

**Manifest vs. revision.** This is git's split between a tree and a commit. A `Manifest` is pure content, so its digest is stable: exporting, re-importing or reverting to the same config always yields the same digest, and "is what's running what I exported?" is one hash comparison. A `Revision` is the history event that points at a manifest, so a rollback is a new revision (new id, new author, new time) whose `manifest` equals an older revision's. An earlier draft used the manifest hash as the revision id, which made a rollback collide with the revision it restored and left no place for who did it and why.

**Secrets are invisible to the digest.** A manifest holds `SecretRef`s, never values, so changing the value behind `{ env: "AUTH_SECRET" }` doesn't change the digest and `plan()` over manifests can't see it. The deployment therefore records a **secret fingerprint** per ref at apply time (an HMAC of the resolved value under a per-install key, never the value itself). `plan` compares current fingerprints against the active revision's and reports "value changed behind ref X" as its own step. Fingerprints live in the lock, not the manifest, so they never leak into the digest or into a Git-committed file.

**Functions don't serialize.** `betterAuth()` takes callbacks (email senders, hooks, plugin callbacks). The config references them by name through a **capability registry** of prebuilt behaviors (`email.smtp`, `email.resend`, `webhook.post`) with parameters. A **plugin registry** maps each plugin `kind` to a factory plus a Zod schema for its options.

## Applications and consumers

The portal (`ritajhq/portal`, branch `feat/authorization`) is the reference case: khatm replaces its hand-wired Better Auth service. Everything below is what portal does by hand today and what khatm must own instead.

### What portal wires by hand

| Concern | Portal today | Scattered across |
| --- | --- | --- |
| App origins | dashboard and admin origins as env vars | Better Auth `trustedOrigins`, the Hono CORS list, and the login page's `return_to` allowlist (injected at container boot) |
| Cookie strategy | `crossSubDomainCookies` on a shared parent domain (`lvh.me` in dev, the real domain in prod); host-only `SameSite=None` as a fallback | `core/auth/server`, env |
| Sign-in round trip | Apps send users to `auth/login?return_to=<url>`; the login page follows it only to a known app origin, else the dashboard | `core/auth/client/sign-in.ts`, `apps/auth/client/auth.ts` |
| Plugins | `emailAndPassword`, `username`, `admin` (for the `role` column only) | `core/auth/server` |
| Caller identity for services | idhn guards call `get-session` server to server with the session cookie, then forward `x-idhn-subject`, `x-idhn-issuer`, `x-idhn-claims` | one guard manifest per service, each repeating `session_url`, cookie name, issuer and claims |
| First admin | `grant-admin` task: SQL `update auth."user" set role = 'admin'` | `ci/portal/scripts/grant-admin.sh` |
| Migrations | `auth-migrate` task running the Better Auth CLI, then a manual restart | `ci/portal/scripts/auth-migrate.sh` |
| User lookup for other services | Internal RPC (`users.search`, `users.getByIds`) querying `auth."user"` directly | `apps/auth/server/users.ts` |

### What khatm owns instead

- **Applications derive the security config.** Each first-party `Application` is declared once. khatm derives `trustedOrigins`, CORS, the hosted login page's `return_to` allowlist and its default landing app from that list. An origin can't be trusted in one place and forgotten in another, and the open-redirect check stops being app code.
- **The cookie strategy is validated, not chosen per env.** When apps share a parent domain, khatm sets `crossSubDomainCookies`. The host-only `SameSite=None` fallback works for browsers but a guard on another host never receives the cookie, so `plan` rejects it once any consumer is declared.
- **The session contract is a published interface.** Guards depend on the cookie name, the introspection URL, the issuer and the claim names. khatm treats them as a contract: it can render the `authentication` block for idhn guard manifests (or serve it for guards to fetch), and `plan` flags any change that breaks it as `destructive` for consumers. Examples: switching `baseURL` between http and https renames the cookie (Better Auth adds the `__Secure-` prefix), removing the `username` plugin drops a claim, and changing `cookieDomain` logs everyone out.
- **End-user roles are separate from operator roles.** Portal's `role` claim (`user`, `admin`) is an app-level role that idhn policies read. It is not the console's Operator/Support roles. khatm manages both, but in different planes: app roles through the admin plugin in Identity Administration, operator roles in the control plane.
- **Bootstrap and lookup become product features.** `grant-admin` becomes `users set-role <email> admin` (CLI and console), and the first app admin can be named in the manifest's first-boot block. Portal's internal users RPC becomes a read-only user directory on the control API (search, get by ids), so no service queries Better Auth's tables directly.
- **Role changes lag by the guard cache.** Guards cache each session for `ttl_seconds`. khatm documents that lag and, when it has a consumer registry, can tell guards to drop a subject's cached session on role change or revocation.

### Not needed for portal v1

OAuth/OIDC apps, JWT/JWKS verification and back-channel logout. Portal's services never verify tokens themselves; the guard in front of them does, through `get-session`. These stay on the roadmap for third-party apps, and Better Auth keeps OAuth clients as `oauthClient` rows, so khatm will sync declared OAuth apps into that table rather than pass them as config.

## Orchestrator runtime

The container runs the orchestrator as PID 1: supervisor, reverse proxy and control API. It spawns the Better Auth worker as a child process. Two ports face outward: a public auth port and a control port that must never be public (or a Unix socket reached via `docker exec`).

### Apply flow

1. Validate the desired manifest against the Zod schemas; check every `SecretRef` resolves and fingerprint it.
2. Compute the plan: config diff, secret fingerprint diff, and Better Auth's migration dry run (see Migrations). Classify each step's impact. Destructive steps need explicit confirmation; manual steps block the apply.
3. Write the artifact bundle (see Artifacts). Failure here fails the apply.
4. Run Better Auth's additive migrations while the old worker is still serving (safe by construction, see Migrations).
5. Spawn the new worker on a fresh internal port and health-check it.
6. Switch the proxy upstream, then drain and stop the old worker.
7. Record the revision as active. On failure at any step, the old worker keeps serving.

### Change impact

| Impact | Examples | Handling |
| --- | --- | --- |
| hot | Branding, copy | No process change |
| restart | New social provider, rate limits, new secret version added | Blue/green swap |
| migration | Plugin added (organization, 2FA) | Additive migrate, then swap |
| manual | Better Auth upgrade with a data step, a renamed field or table, a required column with no default on a populated table | Apply refused until the operator runs the documented step and re-plans |
| destructive | Plugin removed (its tables stay but go unused), last secret version removed, secret value changed behind the same ref (both log everyone out) | Explicit confirmation |

Sessions live in the database, so a normal restart logs nobody out. Rotating the secret is a `restart`, not a `destructive` change, as long as it's done by adding a version: Better Auth's versioned `secrets` (or `BETTER_AUTH_SECRETS`) sign with the newest version and still verify older ones, and lazily re-encrypt on write. Dropping the old version later is the step that invalidates what it signed.

### Migrations

Better Auth owns its schema, and its migrator (`getMigrations(options)` from `better-auth/db/migration`, the same code the `auth migrate` CLI runs) is **additive only**: it creates missing tables, adds missing columns and indexes, and never drops, renames or retypes anything. A type mismatch is only logged as a warning. It refuses (`UnsafeMigrationError`) to add a required column with no default to a table that already has rows. It only works with the built-in Kysely adapter, which is what the orchestrator uses.

That shapes the whole design:

- **Plugin changes are safe during blue/green.** The old worker ignores tables and columns it doesn't know, so migrating before the swap can't break it. This is the expand half of expand/contract, and it is the only half the orchestrator ever runs automatically.
- **`plan` runs the migrator as a dry run.** `getMigrations(..., { throwOnUnsafe: false })` returns `toBeCreated`, `toBeAdded` and `unsafeChanges` without touching the database. The plan shows the tables and columns as `migration` steps and each unsafe change as a `manual` step.
- **Breaking changes come from outside the migrator.** The migrator can't express them, so it never runs them:
  - Better Auth upgrades with data steps. The 1.7 upgrade guide, for example, requires copying `oauthApplication` rows into the new `oauthClient` table and remapping Microsoft account ids to `oid`. The CLI adds the new tables but copies nothing.
  - Renaming a field or table through Better Auth's `fields`/`modelName` options. The migrator adds the new column and silently strands the old data.
  - Contract steps: dropping a removed plugin's tables, or tightening a column to `NOT NULL`.
  
  The plugin registry and the version lock declare these as known `manual` steps per version or option, with the guide link and the SQL to review. The orchestrator never runs them on its own in v1.
- **Rollback is a new apply of an older manifest.** Because migrations only add, rolling back config is always schema-safe: the older worker ignores the extra tables. The exception is a Better Auth version rollback after a data step, which `plan` marks `manual`.
- **The worker caches its schema check** until it restarts (portal hit this), so a migration only takes effect for the new worker, which is another reason migrations run before the swap and never against a live worker.

**Alternative considered:** swapping the `auth` handler in-process. It's simpler and has zero downtime, but a bad config can crash the orchestrator. The child-process design was preferred for crash isolation.

### State and secrets

- Auth data lives in the operator's database.
- Config revisions live in the same database under a separate prefix (`orchestrator_*`), so the container is stateless apart from the database.
- Secrets come only from env vars or mounted files. The config holds references, never values.
- Branding assets are stored in the database as blobs, so a database backup covers everything.

### Config source policy

`configSource` resolves the conflict between a mounted config file (GitOps) and console edits:

- `file`: the mounted file wins on every boot; console config editing is read-only, runtime controls still work.
- `console`: the database is the source of truth; no file is read.
- `file-then-console`: the file seeds the first boot only.

### First boot

1. Check the database connection and run the orchestrator's own migrations.
2. With no revisions yet: load the mounted file, or create a default revision (email and password, default branding).
3. Print a one-time admin token to the logs, like Grafana's initial password.
4. The operator attaches, sets base URL and providers, previews branding and applies.

A `doctor` command checks database reachability, secret resolution, base URL consistency and OAuth redirect URIs.

## Shared code architecture

The CLI and web UI are two remotes for the same TV: the protocol is the product, and neither shell contains auth logic. In a TypeScript monorepo:

| Package | Contents | Used by |
| --- | --- | --- |
| `@orch/core` | Zod schemas (AuthSpec, BrandingSpec, plugin options), `plan(current, desired)`, validation, canonical serialization. Pure, no I/O. | Orchestrator, CLI, UI |
| `@orch/contract` | Typed control API procedures with input/output schemas | Orchestrator (server), client |
| `@orch/client` | SDK: connection (HTTP or Unix socket), admin auth, multi-step workflows | CLI, UI |
| `@orch/cli` | Commands, prompts, table output | Operators, scripts |
| `@orch/web` | Forms, diffs, live preview, user admin | Operators, support staff |

Contract namespaces: `revisions.*`, `plan`, `apply`, `rollback`, `status`, `logs.stream`, `branding.preview`, `export`, `import`, `users.*`, `sessions.*`, `orgs.*`, `audit.*`.

Guidelines:

- Candidate libraries: oRPC or tRPC for end-to-end types; generate OpenAPI from the same definitions for non-TS clients. Log streaming needs SSE or WebSocket support.
- Workflows such as "plan → confirm destructive steps → apply → wait until healthy" live in the SDK. Shells only supply the confirmation callback, so behavior can't drift.
- Because `core` runs client-side, the CLI and UI validate and preview plans before any round trip.
- The web UI generates config forms from the plugin Zod schemas, so a new registry entry yields validation and a form at once.
- Layering test: an `if` about auth config inside a shell belongs in `core`.

## Reproducibility artifacts

Every apply writes a bundle so that, given the bundle and the same database, anyone can recreate an identical instance. Think `package.json` plus `package-lock.json`: what you wanted, and exactly what you got.

### Bundle contents

| File | Purpose |
| --- | --- |
| `manifest.json` | Full resolved AuthSpec + BrandingSpec, secret refs only, canonical serialization. Its hash is the manifest digest. Same format as file-mode config. |
| `revision.json` | Revision id, parent, author, time, reason, manifest digest |
| `lock.json` | Orchestrator image digest, Better Auth version, each plugin's version, registry schema version, secret fingerprints per ref |
| `secrets.required.json` + `.env.example` | Every referenced secret with a description |
| `migrations/` | SQL this revision needs, reviewable by a DBA |
| `branding/` | Tokens, message bundles, custom CSS, assets, content-hashed |
| `plan.md` | Human-readable diff from the parent revision with impact levels |
| `auth.ts` | Eject file: equivalent plain Better Auth code, capabilities turned into stubs |
| `deploy/` | docker-compose and Kubernetes templates pinned to the image digest |

The eject file removes lock-in: anyone can leave the orchestrator and embed Better Auth directly, its native model. It also lets operators read exactly what gets built.

### Write rules

- Order: bundle written before migration and traffic switch; a write failure fails the apply.
- Atomic: write to a temp directory, then rename.
- Location: `/artifacts/<revision-id>/` on a volume, plus revision history and hashes in the database. Bundles are deterministic, so a lost volume can be regenerated.
- `/artifacts/current` symlinks to the active revision.
- Retention: keep all by default, optional `keepLast: n`; never prune the active revision or its parent.
- Artifacts never contain user data or PII.

### Round trip

- `export <revision>` returns a bundle; `import <bundle>` runs through the normal plan and apply flow.
- Exporting from a console-configured instance and committing `manifest.json` to Git is the migration path to file mode.
- `manifest.json` and `lock.json` together answer "is what's running what I exported?": same manifest digest, same lock (image, versions, secret fingerprints). Recording or signing each bundle's hash lets you verify later that what's running matches what was exported.

## Admin console and identity administration

The web UI manages two planes: the control plane (how auth is configured) and the data plane (the people who use it). Like a router's app: one screen configures the Wi-Fi, another shows connected devices. Keep them separate in code and permissions.

### Operations

List and search users; view sessions and linked accounts; ban and unban; revoke sessions; reset password or force verification; set roles; impersonate for support; manage orgs and memberships when that plugin is enabled.

### Rules

- **Go through Better Auth, not SQL.** Admin actions call the running worker's admin plugin endpoints so hooks, validation and plugin cleanup still run. The orchestrator enables the admin plugin automatically when the console is active.
- **Config-aware screens.** Panels appear based on the active config (orgs, 2FA status and reset, passkey list). The plugin registry declares which admin panels each plugin adds.
- **CLI parity.** `users list --search`, `users ban <id>`, `sessions revoke --user <id>`, useful for scripted bulk work.

### Roles

| Role | Control plane | User management | Secrets and artifacts |
| --- | --- | --- | --- |
| Operator | Full | Full | Yes |
| Support | None | Full | No |

### Console authentication

- Admins log into the console through the auth server itself: Better Auth users with an admin role, getting branded login, 2FA and passkeys for free.
- A break-glass token (from first boot) remains for when a bad config breaks login. It is limited to control-plane recovery, not daily user management, and every use is logged loudly.

### Audit log

An append-only audit log in the database records admin actions: who did what to whom, and when. It's separate from artifacts. Impersonation is time-limited, audited, and ideally visible to the impersonated session.

## Branding and hosted UI

Because the auth server is an IdP, it owns the login pages (users are redirected to it and back). This is the Auth0 "Universal Login" problem.

**Core principle:** what appears on a page is derived from `AuthSpec` (password fields, passkey button, provider buttons, 2FA step); how it looks comes from `BrandingSpec`. Enabling a feature never touches the theme, and a theme change never risks breaking auth.

### Customization layers

| Layer | What it covers | Risk |
| --- | --- | --- |
| 1. Design tokens | Colors, logo, favicon, font, radius, light/dark, layout variant (card or split screen), as CSS custom properties | None, applied hot |
| 2. Copy and i18n | Every string overridable per locale, keyed message bundles | None |
| 3. Scoped CSS | Shadow DOM or namespaced classes, stable `::part()` names | Low |
| 4. Slots | Named injection points (header, footer, legal text) accepting sanitized HTML | Medium |
| 5. Headless | API only; client app builds its own pages with the Better Auth client | Customer-owned |

### Implementation notes

- Build hosted pages as a small framework-agnostic bundle (web components or light SSR) so theming is only CSS variables.
- Check the community Better Auth UI component library (believed shadcn-based) for page structure ideas.
- Emails (verification, reset, magic link) use the same tokens, rendered with React Email or MJML.
- Optional per-OAuth-client branding overrides.
- Live preview in the console renders a draft BrandingSpec across every page state (sign-in, sign-up, error, 2FA, email) before apply. Branding changes almost never need a process restart.

## Open questions and build order

### Open questions for the implementation session

- [ ] Which Better Auth version to pin, and which plugins ship in the first registry?
- [ ] Which databases to support at launch (Postgres only, or also MySQL and SQLite)?
- [ ] oRPC or tRPC for the contract?
- [x] How to run migrations programmatically? `getMigrations()` from `better-auth/db/migration`, dry run in `plan`, run in `apply` (see Migrations).
- [ ] Should the orchestrator ever run contract steps (drop orphaned plugin tables) itself, or always leave them to the operator?
- [ ] Hosted pages: web components or SSR, and which framework for the web console?
- [ ] Which prebuilt capabilities (email providers, webhooks) are in v1?
- [ ] Default `configSource` for new deployments?
- [ ] Can impersonation be shown to the impersonated session with Better Auth's admin plugin as-is?
- [ ] Does khatm render idhn guard `authentication` blocks, serve them for guards to fetch, or only validate that guards match the session contract?
- [ ] Should khatm push session invalidations to guards (role change, ban, revoke), or is the `ttl_seconds` lag acceptable?

### Suggested build order

Working backwards from a demo where `apply` swaps a running instance:

1. `@orch/core`: AuthSpec schema for portal's plugin set (email and password, username, admin) plus `Application` and `SessionContract`, canonical serialization, `plan()` with impact classification.
2. Orchestrator: supervisor, child worker built from a revision, reverse proxy, blue/green swap, revision storage.
3. `@orch/contract` + `@orch/client` + minimal CLI: `plan`, `apply`, `status`, `logs`, `rollback`.
4. Artifact bundle on apply, then `export`/`import` and the `auth.ts` eject file.
5. Hosted login pages with design tokens and copy overrides.
6. Web console: config forms from schemas, branding preview.
7. Identity administration, roles, audit log, console login through the auth server.
8. Scoped CSS, slots, headless mode, `doctor`.
