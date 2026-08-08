---
name: simadmin-dev-deploy
description: Build and deploy the current SimAdmin branch to its x86_64 Linux development NAS. Use when developing, testing, updating, or quickly redeploying SimAdmin to 192.168.100.55 over SSH, including frontend/backend builds, systemd restart, health checks, and rollback-safe artifact replacement.
---

# SimAdmin Development Deploy

Deploy the current checkout to the development NAS without replacing SimAdmin state. The default target is `root@192.168.100.55`, with `/opt/simadmin`, `simadmin.service`, and `http://127.0.0.1:3000/api/health`.

## Required workflow

1. Inspect `git status`, the current commit, target architecture, current service state, port `3000`, and ModemManager before deployment. Do not treat a local Docker build as modem validation.
2. Run the helper. It builds the React frontend and an `x86_64-unknown-linux-musl` backend, verifies the result is x86-64 ELF, stages it remotely, atomically swaps only `simadmin`, `www`, and `meta.json`, then restarts the service.
3. Verify `/api/health` from the NAS and from the LAN after a successful deployment. Inspect the service log for the injected branch and commit.
4. State explicitly that the helper preserves `/opt/simadmin/data.db`, `config.json`, and `lpac/`; it does not validate modem-changing features, SIM/eSIM operations, or network changes.

## Run

```bash
bash .codex/skills/simadmin-dev-deploy/scripts/deploy.sh
```

Use `--dry-run` to validate the local build and display the exact deployment target without changing the NAS. Override a development target only deliberately:

```bash
bash .codex/skills/simadmin-dev-deploy/scripts/deploy.sh \
  --host root@192.168.100.55 \
  --remote-root /opt/simadmin \
  --service simadmin \
  --health-url http://127.0.0.1:3000/api/health
```

The helper keeps the prior artifacts in `/opt/simadmin/.rollback-<timestamp>`. On failed restart or health check, it restores those artifacts automatically. Do not remove a rollback directory without user approval.

## Boundaries

- Require a known SSH host key and key-based access. Do not disable host-key verification.
- Stop if the target is not x86_64 Linux, systemd/ModemManager are unavailable, port `3000` has an unexpected owner, or the active service is not SimAdmin.
- Do not use this Skill for releases, OTA publication, database/schema migrations, or production rollouts.
- Do not modify NetworkManager, modem state, SIM/eSIM profiles, or stored configuration as part of deployment.

## Resource

- `scripts/deploy.sh` builds, verifies, stages, deploys, health-checks, and rolls back the SimAdmin web/backend artifacts.
