# Security Policy

## Supported Versions

Security fixes are prepared for the latest released `v0.x` tag. Installations should pin `H2V_REF` to a release tag and avoid moving refs such as `main`.

## Reporting a Vulnerability

Please report security issues privately to the project maintainer before opening a public issue. Include:

- affected version or commit
- deployment mode and exposed ports
- steps to reproduce
- expected impact
- relevant logs with secrets removed

Do not include backup exports, subscription tokens, admin passwords, JWT secrets, Reality keys, or Hysteria secrets in public reports.

## Secrets

Treat these as production secrets:

- `/opt/mypanel/.env`
- PostgreSQL dumps and panel backup exports
- `PANEL_JWT_SECRET`
- `DB_PASSWORD`
- Reality private key
- Hysteria traffic and obfs secrets
- user subscription tokens and Hysteria passwords

If a subscription token leaks, rotate that user's subscription from the admin UI.
