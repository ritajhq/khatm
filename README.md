# khatm

An Ensemble project — source code, build/pack/deploy config, and their outputs
each live in their own top-level folder. See `ens --help` for the full CLI.

## Workspace structure

- `source/apps/<name>/` — one self-contained app per folder. States which build
  kit it uses (`.ensemble/config.yaml`), never how that kit builds it.
- `source/core/` — shared code that speaks this project's business logic.
- `source/libs/` — shared code generic enough to reuse across projects.
- `source/ship/` — how apps are packaged for deployment (Dockerfiles, etc.).
- `source/envs/build/<app>.env` / `source/envs/pack/<ship>.env` — per-app
  default build/pack vars.
- `source/artifacts/` — build output (gitignored, except `deploy/`).
- `ci/<name>/delivery.yml` — deploy manifest for the workload of that name.
- `.ensemble/kits/{build,pack,deploy}/` — pluggable kits doing the actual work.
- `.ensemble/config.yaml` — which kit each app/ship uses (shared, git-tracked).
- `.ensemble/config.local.yaml` — personal default vars (gitignored).
- `.ensemble/deploy/<workload>/last-rendered.txt` — the render cache `plan`
  diffs against (gitignored).

## Getting started

```sh
ens app create <kit> <name>   # scaffold a new app, e.g. `ens app create react web`
ens build <name>              # build it (-w to watch, -m production for prod)
ens pack <ship> <kit>         # package a built app into a deployable artifact
ens deploy <name> <kit>       # bring up a workload from its delivery manifest
ens develop <name>            # deploy the same manifest locally, watching for changes
```

## Command reference

| Command | Purpose |
|---|---|
| `ens app create <kit> <name> [--target <t>]` | Scaffold `source/apps/<name>` from a build kit's template. |
| `ens build <name> [-m development\|production] [-w] [-v KEY=VALUE]` | Build an app through its configured kit. |
| `ens pack <ship> <kit> [-m <mode>] [-o <name>] [-w] [-v KEY=VALUE]` | Pack a built app into a deployable artifact. |
| `ens publish <ship> <kit> <target> [--version <v>] [-v KEY=VALUE]` | Publish a packed artifact (e.g. push a Docker image). |
| `ens deploy <name> <kit> [--eject\|--plan] [--watch] [--version <v>]` | Apply (or preview) a delivery manifest to a target. |
| `ens develop <name> [-k <kit>]` | `deploy` sugar for local dev: watches, emulates externals. |
| `ens config set-build-kit\|set-build-var\|set-pack-var ...` | Associate apps/ships with kits and default vars. |
| `ens release next\|set\|undo` | Compute/create/undo a semver git tag. |
| `ens version [update\|set]` | Show or change the installed `ens` version. |

Run any command with `--help` for its full option list.
