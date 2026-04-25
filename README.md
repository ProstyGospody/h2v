# h2v

Production-oriented VPN panel scaffold.

## Install

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/ProstyGospody/h2v/main/install.sh)
```

The installer now supports direct remote execution: if it is launched without a local repository checkout, it downloads the repository source into a temporary directory and continues from there.
On a fresh Ubuntu host it also bootstraps the exact build toolchain it needs: Go `1.22.12`, Node.js `22.22.2`, npm `10.9.7`.
Frontend package versions are pinned exactly in [frontend/package.json](./frontend/package.json), and the Go toolchain is pinned in [backend/go.mod](./backend/go.mod).
The installer also persists the generated frontend `package-lock.json` under `/opt/mypanel/build/` and reuses it on later rebuilds, so repeated installs on the same host keep the same npm dependency graph.
For immutable source rebuilds, run the installer with an explicit tag or commit via `H2V_REF`; `main` remains mutable by definition.

This repository is split into:

- `backend/`: Go service with admin API, public subscription endpoints, migrations, background jobs, and pluggable Xray/Hysteria adapters.
- `frontend/`: Vite + React admin UI and public subscription page.
- `templates/`: Xray and Hysteria config templates rendered by the backend and install flow.
- `units/`: systemd units aligned with the spec.
- `install.sh`: idempotent installation/update script for Ubuntu hosts.

## Current scope

The repository is bootstrapped from an empty workspace, so the focus here is a coherent application foundation:

- PostgreSQL-backed domain model and migrations
- JWT auth, user CRUD, subscription rendering, settings/config endpoints
- background scheduler, health endpoint, metrics, backup task
- frontend shell for admin and public token views
- deployment assets from the specification

Two transport boundaries remain intentionally isolated behind adapters:

- Xray live gRPC operations
- Hysteria live traffic/kick HTTP operations

The service layer is ready for those adapters, but the exact wire contracts still need to be dropped into `backend/internal/cores/*` on a target machine with the kernel binaries and generated Xray proto package available.

## Build

```bash
make build
```

## Dev

```bash
make dev
```

Review the installer and environment defaults before production rollout.
