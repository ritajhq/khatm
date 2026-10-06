# Authoring the khatm manifest

The manifest is the one file that says how khatm should run: which database
Better Auth uses, how people sign in, which apps share the session, what the
hosted pages look like, and who the first admin is. You write the desired
state; khatm works out what has to change to get there, the way `kubectl
apply` does for a Kubernetes manifest.

This guide covers what each field means, what khatm checks, and what applying
a change will do to a running server.

## A complete example

This is the demo manifest (`source/ship/demo/khatm/manifest.json`), a good
starting point:

```json
{
  "bootstrap": {
    "users": [{ "email": "root@example.com", "name": "Root", "role": "admin" }]
  },
  "auth": {
    "baseURL": "http://auth.khatm.localhost",
    "secrets": [{ "version": 1, "value": { "env": "AUTH_SECRET" } }],
    "database": { "dialect": "sqlite", "url": { "env": "DATABASE" } },
    "emailAndPassword": { "enabled": true },
    "applications": [
      { "kind": "first-party", "id": "console", "origin": "http://console.khatm.localhost" },
      { "kind": "first-party", "id": "service", "origin": "http://service.khatm.localhost" }
    ],
    "session": {
      "cookieDomain": "khatm.localhost",
      "introspectionURL": "http://khatm:4100/api/auth/get-session",
      "issuer": "demo",
      "claims": ["email", "name"]
    }
  }
}
```

The manifest is JSON. Unknown keys are rejected everywhere, so a typo fails
validation instead of being silently ignored.

## Top-level shape

| Key | Required | What it is |
| --- | --- | --- |
| `auth` | yes | Everything Better Auth is built from. Changes here can restart the server, migrate the database or log people out. |
| `branding` | no | How the hosted pages look. Changes apply without a restart. |
| `bootstrap` | no | Users created on first boot only. |

`auth` and `branding` are kept separate on purpose: a branding change can never
change how authentication behaves.

## Secrets: references, never values

A manifest never contains a secret's value, only where to find it:

```json
{ "env": "AUTH_SECRET" }        // read from an environment variable
{ "file": "/run/secrets/auth" } // read from a mounted file
```

So a manifest is safe to commit, diff and export. Secrets are read from the
auth container's environment or filesystem when a worker starts.

Since values aren't in the manifest, changing the value behind a reference
doesn't change the manifest. khatm still notices: at apply time it records a
fingerprint of each value (a keyed hash, never the value itself), and `plan`
reports "value changed behind `env:AUTH_SECRET`" as its own step.

## `auth`

### `baseURL` (required)

The public address of the auth server, as an exact origin: scheme, host and
optional port, with no path, query, trailing slash or wildcard. Better Auth
builds every URL and cookie from it and never from the request's `Host`
header.

```json
"baseURL": "https://auth.ritaj.app"
```

### `secrets` (required)

Better Auth's signing secret, versioned so it can be rotated:

```json
"secrets": [
  { "version": 1, "value": { "env": "AUTH_SECRET_V1" } },
  { "version": 2, "value": { "env": "AUTH_SECRET_V2" } }
]
```

- At least one version is required, and version numbers must be unique
  positive integers.
- The highest version signs session cookies. Older versions are only used to
  decrypt data they encrypted.
- **Adding a new highest version logs everyone out**, because Better Auth
  verifies cookies with the current version only. `plan` marks it
  destructive.
- Removing a version is destructive too: whatever it signed is no longer
  valid.

### `database` (required)

Where Better Auth's tables live.

| Field | Required | Notes |
| --- | --- | --- |
| `dialect` | yes | `postgres`, `mysql`, `sqlite` or `mssql` |
| `url` | yes | A secret reference: a connection string, or a file path for SQLite |
| `schema` | no | Postgres and MSSQL only: the schema for the tables (portal uses `auth`) |

```json
"database": { "dialect": "postgres", "url": { "env": "DATABASE_URL" }, "schema": "auth" }
```

With SQLite, the database is a file both workers open during a swap. khatm
turns on WAL mode, but SQLite still suits single-host deployments only.

Pointing `database` somewhere else is destructive: the server would read and
write a different set of users.

### `emailAndPassword` (optional)

```json
"emailAndPassword": { "enabled": true, "requireVerification": false }
```

With this off and no social providers, the hosted pages have no way to sign
in. `khatm doctor` flags that.

### `socialProviders` (optional)

Sign-in providers by Better Auth's provider id (lowercase letters, digits and
dashes), each with its credentials as secret references:

```json
"socialProviders": {
  "github": {
    "clientId": { "env": "GITHUB_CLIENT_ID" },
    "clientSecret": { "env": "GITHUB_CLIENT_SECRET" }
  }
}
```

Each provider gets a button on the hosted sign-in page.

### `plugins` (optional)

Better Auth plugins by registry `kind`, with their options:

```json
"plugins": [
  { "kind": "username", "options": { "minUsernameLength": 3, "maxUsernameLength": 30 } }
]
```

| Kind | Options | Adds user fields |
| --- | --- | --- |
| `username` | `minUsernameLength`, `maxUsernameLength` (positive integers, optional) | `username`, `displayUsername` |

Each kind can appear only once. An unknown kind, or options that don't match
its schema, is rejected.

You don't declare `admin`. khatm always installs it, because user
administration (ban, set role, revoke sessions) runs through it. Writing it
by hand is an error. It adds the `role`, `banned`, `banReason` and
`banExpires` fields. khatm stores the role and never checks it; idhn policies
read it.

Adding a plugin is a **migration**: it can add tables or columns, which khatm
creates before the new worker takes traffic. Removing one is destructive,
because its tables stay behind unused.

### `applications` (optional)

The apps that use this auth server. Every id must be unique, lowercase letters,
digits and dashes, starting with a letter.

**First-party apps** share the session cookie, like portal's dashboard and
admin:

```json
{ "kind": "first-party", "id": "dashboard", "origin": "https://dashboard.ritaj.app", "landing": true }
```

- `origin` is an exact origin, and no two apps can share one.
- From the first-party origins, khatm derives Better Auth's `trustedOrigins`
  (CORS and CSRF) and the login page's `return_to` allowlist. An app that
  sends users to sign in with `?return_to=<its URL>` must be listed here, or
  users land on the landing app instead. That stops the login page from being
  an open redirect.
- `landing` marks where sign-in goes when there is no valid `return_to`. At
  most one app sets it. Without one, the first first-party app is used.

**OAuth apps** are services on any domain that sign users in through khatm
with OAuth 2.1 and OpenID Connect: a "Login with Ritaj" button.

```json
{
  "kind": "oauth",
  "id": "partner",
  "redirectUris": ["https://partner.example.com/callback"],
  "scopes": ["openid", "profile", "email"],
  "confidential": true,
  "clientSecret": { "env": "PARTNER_CLIENT_SECRET" }
}
```

| Field | Notes |
| --- | --- |
| `id` | The OAuth `client_id` the app sends |
| `redirectUris` | Where codes may be sent: `https` URLs, or plain `http` on a loopback host (`localhost`, `*.localhost`, `127.x.x.x`, `[::1]`) for local development |
| `scopes` | Any of `openid`, `profile`, `email`, `offline_access` (refresh tokens) |
| `confidential` | `true` for an app with a server that can keep a secret; `false` for a browser or mobile app |
| `clientSecret` | A secret reference. Required when `confidential`, not allowed otherwise |

What declaring one does:

- **Turns on the provider.** khatm derives Better Auth's `jwt` and
  `oauth-provider` plugins. Adding the first OAuth app is a `migration`: it
  creates the signing-key and OAuth tables.
- **Registers the client.** Better Auth keeps clients as database rows. Every
  worker brings those rows in line with the manifest before it serves, so the
  manifest is the only way to register a client. Removing an OAuth app deletes
  its client, which `plan` marks destructive.
- **Stores only a hash of the secret.** The value is read from the reference
  when a worker starts.

How an app talks to khatm, with the issuer `<baseURL>/api/auth`:

| What | Where |
| --- | --- |
| Discovery | `<issuer>/.well-known/openid-configuration` (OpenID Connect), `/.well-known/oauth-authorization-server/api/auth` (OAuth) |
| Authorize | `<issuer>/oauth2/authorize` |
| Token | `<issuer>/oauth2/token` (confidential apps use HTTP Basic with `id` and the secret) |
| User info | `<issuer>/oauth2/userinfo` |
| Signing keys | `<issuer>/jwks` |

PKCE is required for every app, confidential or not. Users who aren't signed
in are sent to the hosted login page. Once they sign in or sign up there, the
page sends them back to the app with a code.

For now there is no consent screen: every OAuth app is trusted the way
first-party apps are. Don't declare an app you wouldn't let read the user's
profile and email without asking.

### `session` (required)

The session contract: what resource servers, such as idhn guards, rely on to
identify a caller. Treat it as a published interface. Changing it can break
consumers, and `plan` says so.

| Field | Required | Notes |
| --- | --- | --- |
| `cookieDomain` | no | The shared parent domain, multi-label (`ritaj.app`, `khatm.localhost`; a bare `localhost` is rejected) |
| `introspectionURL` | yes | The **internal** `get-session` address guards call, e.g. `http://khatm:4100/api/auth/get-session` |
| `issuer` | yes | The issuer guards report to policies, e.g. `portal` |
| `claims` | yes | User fields exposed to guards as claims, no duplicates |

About `cookieDomain`:

- Setting it turns on Better Auth's cross-subdomain cookies, so every app
  under that domain receives the session.
- `baseURL` and every first-party origin must be on that domain or one of its
  subdomains. Validation fails otherwise.
- Changing it logs everyone out.

About `claims`:

- Each claim must be a field some installed plugin provides. The core fields
  are always there: `id`, `name`, `email`, `emailVerified`, `image`,
  `createdAt`, `updatedAt`. The admin plugin always adds `role`, `banned`,
  `banReason` and `banExpires`. `username` adds `username` and
  `displayUsername`.
- Adding a claim needs a restart. Dropping one is destructive, since
  policies may read it.

### `hooks` (optional)

Named behaviors from a capability registry, standing in for the callbacks
`betterAuth()` would otherwise take as code:

```json
"hooks": [{ "name": "some-capability", "params": {} }]
```

No capabilities are registered yet, so any entry here fails when a worker
starts. Leave it empty.

## `branding`

All optional. Every branding change is **hot**: it applies without a restart.

```json
"branding": {
  "name": "Ritaj",
  "tokens": { "primary": "oklch(0.55 0.2 260)", "radius": "0.75rem" },
  "messages": { "en": { "signIn.title": "Welcome back" } },
  "parts": { "card": { "box-shadow": "none" } },
  "slots": { "en": { "footer": "<small>© Ritaj · <a href=\"/terms\">Terms</a></small>" } }
}
```

| Field | What it does |
| --- | --- |
| `name` | The service's name on the pages, up to 60 characters. Left out, none is shown. |
| `tokens` | Design tokens, applied as CSS custom properties `--<name>`. |
| `messages` | Copy overrides per locale, keyed by message id. |
| `parts` | Scoped CSS: declarations per named part of the page. |
| `slots` | Sanitized HTML per locale for the header, footer and legal areas. |
| `pages` | `hosted` (default) serves the sign-in pages. `headless` serves none: your own apps build them with the Better Auth client, and khatm keeps only the API. |

**Tokens.** Names are lowercase words joined by dashes. The pages use
`background`, `foreground`, `card`, `card-foreground`, `primary`,
`primary-foreground`, `muted`, `muted-foreground`, `accent`,
`accent-foreground`, `destructive`, `border`, `input`, `ring` and `radius`.

Values end up in a stylesheet, so they must be plain CSS values, up to 200
characters, with no braces, semicolons, angle brackets, backslashes,
comments, `url(`, `@import` or `expression(`.

**Messages.** Ids include `signIn.title`, `signIn.description`,
`signIn.submit`, `signIn.failed`, `signUp.title`, `signUp.submit`,
`error.back` and the field labels `email`, `password`, `name`, `username`.
The full list is in `source/apps/login/src`.

**Parts.** You can style only these parts, which never get renamed: `page`,
`brand`, `card`, `header`, `title`, `description`, `content`, `form`,
`field`, `label`, `input`, `submit`, `social`, `provider`, `alert`, `switch`,
`slot-header`, `slot-footer`, `slot-legal`.

Property names are lowercase CSS properties, or custom properties such as
`--radius`. Values follow the token rules.

**Slots.** `header`, `footer` and `legal`, up to 4000 characters each. Only
`a`, `b`, `br`, `em`, `i`, `li`, `ol`, `p`, `small`, `span`, `strong` and
`ul` are allowed, and the only attribute is `a`'s `href`.

Links must be `http(s)://`, `mailto:` or a same-site path. Anything the
sanitizer would drop fails validation, so what you wrote is what appears.
The page picks the visitor's locale the same way as for `messages`, falling
back to `en`.

## `bootstrap`

Users to create the first time a revision with this block goes live, such as
the first admin:

```json
"bootstrap": {
  "users": [{ "email": "root@example.com", "name": "Root", "role": "admin" }]
}
```

- `email` and `name` are required; `role` is optional.
- It runs once. After it succeeds, later edits to the block are ignored, so
  it isn't part of the manifest's digest and never shows up in `plan`.
- Users are created **without a password**. Set one over the control socket:

  ```sh
  printf '%s' "$PASSWORD" | docker exec -i khatm khatm users set-password root@example.com
  ```

## What khatm adds for you

Some Better Auth settings are derived from what you wrote, so they can't fall
out of sync:

| Derived setting | From |
| --- | --- |
| `trustedOrigins` | first-party application origins |
| Login page `return_to` allowlist and landing app | first-party applications |
| `advanced.crossSubDomainCookies` | `session.cookieDomain` |
| The `admin` plugin | always on |
| The `jwt` and `oauth-provider` plugins, and turning off the jwt plugin's own `/token` | any OAuth application |

`plan` lists changes to derived settings as `derived[...]` steps, so you can
see the knock-on effect of an edit.

## What a change will do

`plan` compares your manifest with the running one and rates every step. The
most disruptive step sets the impact of the whole apply.

| Impact | Meaning | Typical causes |
| --- | --- | --- |
| `hot` | Applies with no restart | Any `branding` change |
| `restart` | A new worker starts and takes over with no sessions dropped | New claims, new applications, a new `baseURL`, most `auth` edits |
| `migration` | The database is migrated before the new worker takes traffic | Adding a plugin, adding the first OAuth app |
| `manual` | An operator must act first; `plan` says what | Data checks Better Auth needs before an upgrade |
| `destructive` | Logs people out, breaks consumers or orphans data; needs explicit confirmation | Rotating the signing secret, changing `cookieDomain` or `database`, dropping a claim, removing a plugin, removing an OAuth app |

Every apply runs as a blue/green swap: the new worker has to start and pass
health checks before traffic moves to it. If it doesn't, the old one keeps
serving.

## Applying a manifest

Validate a draft before applying it:

```sh
khatm doctor manifest.json
```

This checks the manifest the way this installation would run it: missing
secrets, pending migrations, a sign-in page with no sign-in method, a cookie
strategy that guards can't use. Add `--guard <file.yaml>` to check consumers'
idhn guard manifests against it.

Then apply it:

```sh
khatm plan manifest.json                 # what would change, and how disruptive it is
khatm apply manifest.json --reason "…"   # apply; add --yes for destructive changes
khatm status                             # which revision is serving
khatm rollback <revision> --yes          # apply an earlier revision's manifest again
```

The CLI talks to the orchestrator over its Unix socket, so run it inside the
container (`docker exec khatm khatm …`).

A manifest can also be applied on start: set `KHATM_MANIFEST` to its path, and
`KHATM_CONFIRM=true` to allow destructive changes. The demo deployment does
this. If that manifest is already the running one, nothing happens.

Every apply records a **revision**: the manifest, who applied it, when and
why. Two manifests with the same content have the same digest, so a revision
can always be compared with an exported or committed manifest. A rollback is
a new revision whose manifest equals an older one.
