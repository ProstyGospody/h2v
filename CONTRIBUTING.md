# Contributing to h2v

Thanks for helping improve h2v. This project is a self-hosted VPN panel, so changes should be conservative, auditable, and safe for production operators.

## Development Setup

Backend:

```bash
cd backend
go test ./...
go vet ./...
```

Frontend:

```bash
cd frontend
npm ci
npm run lint
npm run build
npm audit --audit-level=high
```

Installer:

```bash
bash -n install.sh
```

Run ShellCheck when available:

```bash
shellcheck install.sh
```

## Change Guidelines

- Keep changes scoped. Avoid unrelated refactors in bugfix PRs.
- Treat `install.sh`, `backend/schema.sql`, `templates/*.tmpl`, and `units/*` as production-critical.
- Do not commit real `.env` files, database dumps, certificates, private keys, backup exports, subscription tokens, or generated runtime configs.
- Preserve backward compatibility unless the PR explicitly documents a breaking change.
- Update `README.md`, `.env.example`, and `SECURITY.md` when user-facing behavior, runtime settings, or security posture changes.
- Add focused tests for backend service, repository, parser, and config-rendering changes.
- Keep frontend UI consistent with the existing React/Vite/TanStack patterns.

## Pull Requests

Before opening a PR:

- `git status --short` should contain only intentional files.
- `go test ./...` and `go vet ./...` should pass in `backend`.
- `npm run lint`, `npm run build`, and `npm audit --audit-level=high` should pass in `frontend`.
- `bash -n install.sh` should pass.

For installer or runtime changes, include a short rollback note in the PR description.
