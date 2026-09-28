# Better Auth Orchestrator — Design Handoff

Sep 28, 2026 · @Ali

## Purpose

We are building a self-hosted, single-tenant auth appliance: an orchestrator that takes a declarative config, builds the `betterAuth()` instance from it, and runs, restarts and manages the auth server process. A CLI and a web console share the same logic to configure it and administer users.

This inverts Better Auth's usual model. Better Auth normally lives inside the app, configured in code. Here it becomes a standalone identity provider (IdP), like a TypeScript-powered Keycloak. Client apps sit on other origins and integrate as OAuth/OIDC clients, so the auth server leans on plugins such as OIDC provider, JWT and bearer. This decision shapes everything else, especially the hosted login UI.

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
| Configuration | `ConfigRevision`, `AuthSpec` | Desired state; revisions immutable, content-hashed |
| Runtime | `AuthInstance`, `Deployment` | Actual state: `Starting → Healthy → Draining → Stopped \| Crashed` |
| Control | Plan, apply, rollback, status, logs, export, import | Exposed through the control API |
| Presentation | `BrandingSpec`, hosted pages, email templates | Separate lifecycle; changes applied hot |
| Identity Administration | Users, sessions, accounts, orgs, audit log | Goes through Better Auth's admin plugin |

Type sketch (design level, not final):

```ts
type ConfigRevision = {
  id: RevisionId;            // hash of canonical manifest
  parent?: RevisionId;
  createdAt: Date;
  author: OperatorId;
  auth: AuthSpec;            // serializable, no functions
  branding: BrandingSpec;
};

type AuthSpec = {
  baseURL: string;
  secret: SecretRef;
  database: DatabaseSpec;
  emailAndPassword?: { enabled: boolean; requireVerification?: boolean };
  socialProviders: Record<ProviderId, { clientId: SecretRef; clientSecret: SecretRef }>;
  plugins: PluginSpec[];     // discriminated union by `kind`
  hooks: CapabilityRef[];    // named references, not code
};

type SecretRef = { env: string } | { file: string };

type ChangeImpact = "hot" | "restart" | "migration" | "destructive";
type PlanStep = { path: string; before: unknown; after: unknown; impact: ChangeImpact };

type Deployment = {
  activeRevision: RevisionId;
  configSource: "file" | "console" | "file-then-console";
  instance: AuthInstance;    // one live, plus one transient during rollout
};
```

**Functions don't serialize.** `betterAuth()` takes callbacks (email senders, hooks, plugin callbacks). The config references them by name through a **capability registry** of prebuilt behaviors (`email.smtp`, `email.resend`, `webhook.post`) with parameters. A **plugin registry** maps each plugin `kind` to a factory plus a Zod schema for its options.

## Orchestrator runtime

The container runs the orchestrator as PID 1: supervisor, reverse proxy and control API. It spawns the Better Auth worker as a child process. Two ports face outward: a public auth port and a control port that must never be public (or a Unix socket reached via `docker exec`).

### Apply flow

1. Validate the desired revision against the Zod schemas; check every `SecretRef` resolves.
2. Compute the plan and classify each step's impact. Destructive steps need explicit confirmation.
3. Write the artifact bundle (see Artifacts). Failure here fails the apply.
4. Run schema migrations if any plugin changes need them.
5. Spawn the new worker on a fresh internal port and health-check it.
6. Switch the proxy upstream, then drain and stop the old worker.
7. Record the revision as active. On failure at any step, the old worker keeps serving.

### Change impact

| Impact | Examples | Handling |
| --- | --- | --- |
| hot | Branding, copy | No process change |
| restart | New social provider, rate limits | Blue/green swap |
| migration | Plugin added (organization, 2FA) | Migrate, then swap |
| destructive | `secret` rotated (kills all sessions), plugin removed (orphans data) | Explicit confirmation |

Sessions live in the database, so a normal restart logs nobody out.

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
| `manifest.json` | Full resolved AuthSpec + BrandingSpec, secret refs only, canonical serialization. Its hash is the revision ID. Same format as file-mode config. |
| `lock.json` | Orchestrator image digest, Better Auth version, each plugin's version, registry schema version |
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
- Location: `/artifacts/<revision-hash>/` on a volume, plus revision history and hashes in the database. Bundles are deterministic, so a lost volume can be regenerated.
- `/artifacts/current` symlinks to the active revision.
- Retention: keep all by default, optional `keepLast: n`; never prune the active revision or its parent.
- Artifacts never contain user data or PII.

### Round trip

- `export <revision>` returns a bundle; `import <bundle>` runs through the normal plan and apply flow.
- Exporting from a console-configured instance and committing `manifest.json` to Git is the migration path to file mode.
- Recording or signing each bundle's hash lets you verify later that what's running matches what was exported.

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
- [ ] How to run migrations programmatically from the orchestrator (Better Auth CLI vs. its migration API)?
- [ ] Hosted pages: web components or SSR, and which framework for the web console?
- [ ] Which prebuilt capabilities (email providers, webhooks) are in v1?
- [ ] Default `configSource` for new deployments?
- [ ] Can impersonation be shown to the impersonated session with Better Auth's admin plugin as-is?

### Suggested build order

Working backwards from a demo where `apply` swaps a running instance:

1. `@orch/core`: AuthSpec schema for a small plugin set, canonical serialization, `plan()` with impact classification.
2. Orchestrator: supervisor, child worker built from a revision, reverse proxy, blue/green swap, revision storage.
3. `@orch/contract` + `@orch/client` + minimal CLI: `plan`, `apply`, `status`, `logs`, `rollback`.
4. Artifact bundle on apply, then `export`/`import` and the `auth.ts` eject file.
5. Hosted login pages with design tokens and copy overrides.
6. Web console: config forms from schemas, branding preview.
7. Identity administration, roles, audit log, console login through the auth server.
8. Scoped CSS, slots, headless mode, `doctor`.
