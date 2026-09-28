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
| Packaging | Two images. The auth image runs the orchestrator as PID 1 plus a Better Auth child process; the console image is stateless | Blue/green works inside the auth container; the console scales to any number of instances |
| Better Auth | 1.7, at least 1.7.3 | Portal (on 1.6) upgrades when it adopts khatm; OAuth apps use `@better-auth/oauth-provider`, since 1.7 removed `oidcProvider` |
| Interfaces | CLI and web UI, both thin shells over a shared SDK | All logic lives in shared packages |
| Artifacts | Written automatically on every apply | An apply fails if its artifact can't be written |
| Admin scope | The web UI is also the user admin console | New Identity Administration context with an audit log |
| Authorization | idhn, for khatm itself as for any service | khatm has no roles or permissions of its own; idhn guards sit in front of the console and the control API |
| Language | TypeScript on Deno, domain modeling first | Domain schemas are the source of truth; the validation library is open |
| Workspace | An Ensemble project, like portal and idhn | Layout, build, pack and deploy follow Ensemble (see Workspace layout) |

### Non-goals

- **Authorization.** khatm says who the caller is; what they may do is idhn's job (guards, judge, policies), including who may operate khatm itself. khatm only publishes the claims idhn reads and the actions its own control API exposes.
- **Multi-tenancy.** One deployment serves one product (portal), with one manifest and one branding spec.
- **Active-active high availability of the auth container.** One orchestrator serves at a time. A second auth container is safe (see Concurrency) but passive: it waits on the apply lock and proxies nothing until it holds the lease. The console is the part that runs many instances.
- **Running user code.** Hooks and callbacks are named capabilities from a registry, never code in the manifest.
- **Importing users from other identity providers** in v1.

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
  bootstrap?: BootstrapSpec; // users and roles created on first boot only; not part of the digest
};
type ManifestDigest = string; // hash of the canonical serialization of a Manifest

// Event: someone applied a manifest at a point in time.
type Revision = {
  id: RevisionId;            // unique per event, not derived from content
  parent?: RevisionId;       // the revision that was active when this one was planned
  manifest: ManifestDigest;
  createdAt: Date;
  author: Subject;           // idhn's x-idhn-subject for the caller, or "socket"
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

**Functions don't serialize.** `betterAuth()` takes callbacks (email senders, hooks, plugin callbacks). The config references them by name through a **capability registry** of prebuilt behaviors (`email.smtp`, `email.resend`, `webhook.post`) with parameters. A **plugin registry** maps each plugin `kind` to a factory plus a schema for its options.

**Authored vs. resolved manifest.** The operator writes the *authored* manifest. Before anything else, `core` expands it into the *resolved* manifest, which is what the worker is built from, what the digest covers and what `plan` diffs. Nothing reaches `betterAuth()` that isn't in the resolved form. Expansion rules live in the registries and are pure functions of the authored manifest plus the registry version in the lock:

| Derived entry | Comes from |
| --- | --- |
| `trustedOrigins`, CORS origins, login `return_to` allowlist | `applications` |
| `advanced.crossSubDomainCookies` | `session.cookieDomain` |
| `admin` plugin, with khatm's service identity in `adminUserIds` | Identity Administration being enabled, or any app role in use |
| `oauthProvider` (`@better-auth/oauth-provider`) + `jwt` plugins | any `oauth` application |
| `deviceAuthorization` plugin | the CLI logging in over HTTP (see Authorization) |
| The console's own first-party `Application` | the console being enabled |

Every derived entry carries its rule (`derivedFrom: "applications"`), so `plan` can say why a line changed even when the operator never wrote it. An operator can't author a derived entry directly; to change it, they change what it derives from.

**Invariants and events.** What each aggregate guarantees, and what it announces:

| Aggregate | Invariants | Events |
| --- | --- | --- |
| `Revision` | Append-only; `parent` equals the active revision at plan time; its manifest validates and every ref resolves | `RevisionPlanned`, `RevisionApplied`, `RevisionRejected` |
| `Deployment` | At most one active revision and one live worker, plus at most one candidate during rollout; active only changes through apply | `WorkerStarted`, `WorkerHealthy`, `TrafficSwitched`, `WorkerCrashed`, `ApplyFailed` |
| `Application` | Unique id and origin; first-party origins share `cookieDomain` when one is set; no wildcard origins | via `RevisionApplied` |
| `SessionContract` | Claims only name fields some plugin provides; changes are `destructive` for consumers | `SessionContractChanged` |
| Audit | Append-only; every control-plane and data-plane write produces exactly one entry | — |


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
- **Roles are user data, not khatm permissions.** Portal's `role` claim (`user`, `admin`) is a field on the user that idhn policies read. khatm stores and edits it through the admin plugin, and never checks it itself.
- **Bootstrap and lookup become product features.** `grant-admin` becomes `users set-role <email> admin` (CLI and console), and the first admin can be named in the manifest's `bootstrap` block (see First boot). Portal's internal users RPC becomes a read-only user directory on the control API (search, get by ids), so no service queries Better Auth's tables directly.
- **Role changes lag by the guard cache.** Guards cache each session for `ttl_seconds`. khatm documents that lag and, when it has a consumer registry, can tell guards to drop a subject's cached session on role change or revocation.

### Not needed for portal v1

OAuth/OIDC apps, JWT/JWKS verification and back-channel logout. Portal's services never verify tokens themselves; the guard in front of them does, through `get-session`. These stay on the roadmap for third-party apps, and Better Auth keeps OAuth clients as `oauthClient` rows, so khatm will sync declared OAuth apps into that table rather than pass them as config.

## Orchestrator runtime

The container runs the orchestrator as PID 1: supervisor, reverse proxy and control API. It spawns the Better Auth worker as a child process. Two ports face outward: a public auth port, and a control port reachable only on the internal network, where the console instances and the control API's idhn guard call it. A Unix socket, reached via `docker exec`, bypasses the network entirely. The proxy forwards the public `Host` unchanged, so Better Auth 1.7 builds the right base URL and cookies without trusting forwarded headers.

### Apply flow

1. Resolve the authored manifest, validate it against the domain schemas, check every `SecretRef` resolves and fingerprint it.
2. Compute the plan: config diff, secret fingerprint diff, and Better Auth's migration dry run (see Migrations). Classify each step's impact. Destructive steps need explicit confirmation; manual steps block the apply.
3. Take the apply lock and check the plan is still current (see Concurrency). Otherwise stop and ask for a re-plan.
4. Write the artifact bundle (see Artifacts). Failure here fails the apply.
5. Run Better Auth's additive migrations while the old worker is still serving (safe by construction, see Migrations).
6. Spawn the new worker on a fresh internal port and wait until it is healthy (see Health).
7. Switch the proxy upstream, then drain and stop the old worker.
8. Record the revision as active, write the audit entry and release the lock. On failure at any step, the old worker keeps serving and the lock is released.

### Concurrency

Two operators, a console edit racing a CLI apply, or a file-mode boot racing a console apply can all try to change the active revision. Two rules settle it, like a compare-and-swap:

- **A plan is bound to its base.** A plan records the active revision it was computed against (`base`), the desired manifest digest and the secret fingerprints it saw. `apply` takes a plan, not a manifest, and is refused when the active revision is no longer `base` or a fingerprint changed since. The operator re-plans and sees the other change in the diff instead of silently overwriting it.
- **One apply at a time.** Applies serialize on a lock held in the database (a lease row with holder and expiry, renewed while the apply runs), so it also holds across two containers. A lease that expires mid-apply means the holder died: the next holder finds the candidate worker gone, the active revision unchanged, and starts clean.

Rollback and import go through the same path: they produce a plan against the current base.

### Health

A worker is healthy when all of these pass, in order, within a timeout:

1. The process is up and listening on its internal port.
2. `GET /api/auth/ok` answers 200.
3. A `get-session` call with no cookie answers `null`, which proves the database and schema are reachable. A missing table fails here, not on the first real sign-in.
4. Every declared first-party origin passes the CORS preflight the proxy will see.

The same checks, run against the live worker, back `status` and the container's own health endpoint.

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
- **Portal's move from 1.6 to 1.7 is additive for its plugins** (email and password, username, admin): none of the 1.7 data steps apply to them. The one preflight is the guide's duplicate `(providerId, accountId)` check, which the registry runs as a `manual` step in `plan`. Better Auth 1.7.0 to 1.7.2 added a required `issuer` column that 1.7.3 removed, which is why the pin starts at 1.7.3.
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
3. Apply the manifest's `bootstrap` block once: create the users it names and set the roles it gives them. It never runs again, and later edits to it are ignored.
4. The operator uses the Unix socket until the console and its idhn guard are set up: `docker exec khatm khatm plan` and `apply` work before anyone can sign in.

A `doctor` command checks database reachability, secret resolution, base URL consistency and OAuth redirect URIs.

## Shared code architecture

The CLI and web UI are two remotes for the same TV: the protocol is the product, and neither shell contains auth logic.

### Workspace layout

khatm is an Ensemble project, so the split follows Ensemble's rule: `core` speaks khatm's domain, `libs` is generic enough for any project, and each app is a separately buildable unit.

| Path | Contents | Used by |
| --- | --- | --- |
| `source/core/spec` | Domain types and schemas (Manifest, Revision, AuthSpec, Application, SessionContract, BrandingSpec), `resolve()`, canonical serialization, `plan(current, desired)`. Pure, no I/O. | Everything |
| `source/core/registry` | Plugin and capability registries: option schemas, factories, derivation rules, known `manual` steps per version | orchestrator, worker, console |
| `source/core/contract` | The control API: procedure names with input and output schemas | orchestrator (server), `core/client` |
| `source/core/client` | SDK: connection (HTTP or Unix socket), sending the caller's session, multi-step workflows | cli, console |
| `source/libs/supervisor` | Child process lifecycle and a switchable reverse proxy, nothing auth-specific | orchestrator |
| `source/apps/orchestrator` | PID 1: supervisor, proxy, control API, revision store, apply lock | — |
| `source/apps/worker` | The Better Auth process, built from a resolved manifest it is handed at start | — |
| `source/apps/cli` | Commands, prompts, table output | Operators, scripts |
| `source/apps/console/{server,client}` | Forms, diffs, live preview, user admin. Stateless | Whoever idhn lets in |
| `source/apps/login` | Hosted sign-in pages, served by the worker's origin | End users |
| `source/ship/khatm` | The auth image: orchestrator and worker | — |
| `source/ship/console` | The console image | — |
| `source/ship/guard/control` | The idhn guard manifest for the control API, one action per contract procedure | Consumers' idhn deployment |
| `ci/khatm/delivery.yml` | Dev stack: Postgres plus khatm, run with `ens develop khatm` | Contributors |

Consumers deploy khatm as two `compute` entries in their own delivery manifest: `khatm` with one replica and `khatm-console` with as many as they like, each behind an idhn guard. For portal, they replace today's `auth` and `auth-web` computes and the `auth-migrate` and `grant-admin` tasks.

Running Better Auth on Deno is proven by portal. khatm avoids portal's one Deno snag, the migrate CLI failing to resolve workspace imports, because it calls `getMigrations()` in-process instead of the CLI.

### Authorization

khatm authenticates and idhn authorizes, for khatm's own surfaces exactly as for portal's services:

- **Console.** An idhn guard sits in front of the console. Operators sign in on the hosted login like any user, and idhn policies decide who gets in. The console forwards the caller's session to the control API.
- **Control API over HTTP.** An idhn guard sits in front of the control port. khatm ships its guard manifest (`source/ship/guard/control`): one action per contract procedure (`khatm.plan`, `khatm.apply`, `users.ban`, ...) with the facts policies need, such as the target user id. The policies are the consumer's. The orchestrator reads the caller from `x-idhn-subject` for revisions and the audit log, and trusts nothing else about them.
- **CLI.** `khatm login` runs Better Auth's device authorization flow against khatm's own auth server: it prints a code, the operator approves it in the browser, and the CLI gets a session token. It sends that token as the session cookie, so the same guard handles it.
- **Unix socket** (`docker exec khatm khatm plan`): trusted by filesystem access, no guard. It is the break-glass path when a bad config breaks sign-in, and every use is audited as the `socket` subject.

Contract namespaces: `revisions.*`, `plan`, `apply`, `rollback`, `status`, `logs.stream`, `branding.preview`, `export`, `import`, `users.*`, `sessions.*`, `orgs.*`, `audit.*`.

Guidelines:

- The contract's transport is open. Portal's own Horizon/mux libraries are one candidate; whatever is picked must support streaming for `logs.stream` and be describable for non-TypeScript clients.
- Workflows such as "plan → confirm destructive steps → apply → wait until healthy" live in the SDK. Shells only supply the confirmation callback, so behavior can't drift.
- Because `core` runs client-side, the CLI and UI validate and preview plans before any round trip.
- The web UI generates config forms from the plugin option schemas, so a new registry entry yields validation and a form at once.
- Layering test: an `if` about auth config inside a shell belongs in `core`.

## Reproducibility artifacts

Every apply writes a bundle so that, given the bundle and the same database, anyone can recreate an identical instance. Think `package.json` plus `package-lock.json`: what you wanted, and exactly what you got.

### Bundle contents

| File | Purpose |
| --- | --- |
| `manifest.json` | The resolved manifest, secret refs only, canonical serialization. Its hash is the manifest digest. |
| `manifest.authored.json` | What the operator wrote, in the same format as a file-mode config file |
| `revision.json` | Revision id, parent, author, time, reason, manifest digest |
| `lock.json` | Orchestrator image digest, Better Auth version, each plugin's version, registry schema version, secret fingerprints per ref |
| `secrets.required.json` + `.env.example` | Every referenced secret with a description |
| `migrations/` | SQL this revision needs, reviewable by a DBA |
| `branding/` | Tokens, message bundles, custom CSS, assets, content-hashed |
| `plan.md` | Human-readable diff from the parent revision with impact levels |
| `auth.ts` | Eject file: equivalent plain Better Auth code, capabilities turned into stubs |
| `deploy/` | A delivery manifest `compute` entry for Ensemble, pinned to the image digest |

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
- Exporting from a console-configured instance and committing `manifest.authored.json` to Git is the migration path to file mode.
- `manifest.json` and `lock.json` together answer "is what's running what I exported?": same manifest digest, same lock (image, versions, secret fingerprints). Recording or signing each bundle's hash lets you verify later that what's running matches what was exported.

## Admin console and identity administration

### Console deployment

The console runs in its own container so it can run as many instances as needed:

- **Stateless.** It holds no config, lock or session state. Every read and write goes through the control API, so the orchestrator stays the single writer and the apply lock still covers every change.
- **Sessions come from the auth server.** The console is a first-party `Application` (derived when the console is enabled), so the shared session cookie reaches it like any portal app.
- **Streams are per viewer.** Each instance opens its own `logs.stream` and status subscriptions to the orchestrator, and nothing is shared between instances.
- **Branding preview is local.** The console renders a draft BrandingSpec with `core/spec` and the login package, without calling the worker, so previews don't load the auth server.

The web UI manages two planes: the control plane (how auth is configured) and the data plane (the people who use it). Like a router's app: one screen configures the Wi-Fi, another shows connected devices. Keep them separate in code, and give each its own idhn actions.

### Operations

List and search users; view sessions and linked accounts; ban and unban; revoke sessions; reset password or force verification; set a user's app role; impersonate for support; manage orgs and memberships when that plugin is enabled.

### Rules

- **Go through Better Auth, not SQL.** Admin actions call the running worker's admin plugin endpoints so hooks, validation and plugin cleanup still run. Those endpoints check Better Auth's own admin role, so the orchestrator calls them on the worker's internal port as khatm's service identity: a user the resolved manifest lists in `adminUserIds`, holding a session the worker creates for it at start and hands only to the orchestrator. idhn has already authorized the human by then, and the audit entry names them, not the service identity.
- **Config-aware screens.** Panels appear based on the active config (orgs, 2FA status and reset, passkey list). The plugin registry declares which admin panels each plugin adds.
- **CLI parity.** `users list --search`, `users ban <id>`, `sessions revoke --user <id>`, useful for scripted bulk work.

### Audit log

An append-only audit log in the database records both planes: control-plane actions (plan, apply, rollback, import, export, socket use, lock takeover) and data-plane actions (ban, revoke, set role, impersonate). Each entry says who did what to whom (the idhn subject), and when, and links the revision when there is one. It's separate from artifacts. Impersonation is time-limited, audited, and ideally visible to the impersonated session.

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
- Emails (verification, reset, magic link) use the same tokens; the rendering library is open.
- Optional per-OAuth-client branding overrides.
- Live preview in the console renders a draft BrandingSpec across every page state (sign-in, sign-up, error, 2FA, email) before apply. Branding changes almost never need a process restart.

## Open questions and build order

### Open questions for the implementation session

- [x] Which Better Auth version? 1.7, at least 1.7.3. The first registry ships portal's plugins (email and password, username, admin) plus device authorization for the CLI.
- [ ] Which databases to support at launch (Postgres only, or also MySQL and SQLite)?
- [ ] Which transport for the control API contract (portal's Horizon/mux, or another)?
- [x] How to run migrations programmatically? `getMigrations()` from `better-auth/db/migration`, dry run in `plan`, run in `apply` (see Migrations).
- [ ] Should the orchestrator ever run contract steps (drop orphaned plugin tables) itself, or always leave them to the operator?
- [ ] Hosted pages: web components or SSR, and which framework for the web console?
- [ ] Does calling admin endpoints as a service identity in `adminUserIds` cover every Identity Administration operation, including impersonation, or do some need Better Auth's internal adapter?
- [ ] Should idhn gain a bearer scheme for the CLI, or is sending the session token as a cookie enough?
- [ ] Which prebuilt capabilities (email providers, webhooks) are in v1?
- [ ] Default `configSource` for new deployments?
- [ ] Can impersonation be shown to the impersonated session with Better Auth's admin plugin as-is?
- [ ] Does khatm render idhn guard `authentication` blocks, serve them for guards to fetch, or only validate that guards match the session contract?
- [ ] Should khatm push session invalidations to guards (role change, ban, revoke), or is the `ttl_seconds` lag acceptable?

### Suggested build order

Working backwards from a demo where `apply` swaps a running instance:

1. `core/spec` and `core/registry`: AuthSpec schema for portal's plugin set (email and password, username, admin) plus `Application` and `SessionContract`, canonical serialization, `plan()` with impact classification.
2. Orchestrator: supervisor, child worker built from a resolved manifest, reverse proxy, health checks, blue/green swap, revision storage, apply lock.
3. `core/contract` + `core/client` + minimal CLI (Unix socket first): `plan`, `apply`, `status`, `logs`, `rollback`.
4. Artifact bundle on apply, then `export`/`import` and the `auth.ts` eject file.
5. Hosted login pages with design tokens and copy overrides.
6. Console image and the control API's idhn guard manifest: config forms from schemas, branding preview, running behind idhn with several instances.
7. Identity administration and the audit log.
8. Scoped CSS, slots, headless mode, `doctor`.
