# h2v

Production-oriented VPN panel scaffold based on `SPEC.md`.

This repository is split into:

- `backend/`: Go service with admin API, public subscription endpoints, migrations, background jobs, and pluggable Xray/Hysteria adapters.
- `frontend/`: Vite + React admin UI and public subscription page.
- `templates/`: Xray and Hysteria config templates rendered by the backend and install flow.
- `units/`: systemd units aligned with the spec.
- `install.sh`: idempotent installation/update script for Ubuntu hosts.

## Current scope

The repository is bootstrapped from an empty workspace, so the focus here is a coherent application foundation:

- PostgreSQL-backed domain model and migrations
- JWT auth, user CRUD, subscription rendering, settings/config/audit endpoints
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

`SPEC.md` remains the authoritative contract for production hardening and rollout details.

