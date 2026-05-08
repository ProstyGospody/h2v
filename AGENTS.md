# AGENTS.md

Guidance for AI coding agents and maintainers working in this repository.

## Project Shape

- Backend module: `backend`, Go module `github.com/prost/h2v/backend`.
- Backend entrypoint: `backend/cmd/panel/main.go`.
- Frontend: `frontend/src`, React 19 + Vite + TypeScript + TanStack Router/Query.
- Database schema: `backend/schema.sql`.
- Installer: `install.sh`.
- Runtime templates: `templates/*.tmpl`.
- systemd units: `units/*.service`, `units/*.timer`.

## Rules

- Do not commit secrets, `.env` files, dumps, generated configs, private keys, certificates, logs, or backup exports.
- Keep line endings LF. `.gitattributes` defines repository policy.
- Prefer small, focused changes over broad refactors.
- Treat `install.sh`, `backend/schema.sql`, `templates/*.tmpl`, and `units/*` as production-critical.
- Do not remove migration or cleanup compatibility unless the user explicitly confirms the compatibility break.
- Use existing local patterns before adding new abstractions.
- For frontend changes, keep the application UI functional first; avoid marketing-style pages.

## Verification

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
shellcheck install.sh
```

If a toolchain is unavailable, state that explicitly in the final response.

## Runtime Contracts

- `.env.example`, `backend/internal/config/config.go`, `install.sh`, `units/*`, and `templates/*.tmpl` must stay aligned.
- Frontend API calls in `frontend/src/shared/api` and `frontend/src/features/*` must match routes in `backend/internal/api/server.go`.
- Installer defaults must not silently overwrite existing `/opt/mypanel/.env` secrets.
- systemd unit paths must match `INSTALL_DIR=/opt/mypanel` unless a deliberate migration is implemented.
