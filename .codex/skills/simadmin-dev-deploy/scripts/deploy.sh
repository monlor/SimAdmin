#!/usr/bin/env bash
set -euo pipefail

host=root@192.168.100.55
remote_root=/opt/simadmin
service=simadmin
health_url=http://127.0.0.1:3000/api/health
dry_run=false

usage() {
  printf '%s\n' 'Usage: deploy.sh [--host USER@HOST] [--remote-root PATH] [--service NAME] [--health-url URL] [--dry-run]'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) host=${2:?missing value}; shift 2 ;;
    --remote-root) remote_root=${2:?missing value}; shift 2 ;;
    --service) service=${2:?missing value}; shift 2 ;;
    --health-url) health_url=${2:?missing value}; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'error: unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$remote_root" == /opt/simadmin || "$remote_root" == /opt/simadmin/* ]] || {
  printf '%s\n' 'error: remote root must stay under /opt/simadmin' >&2; exit 2
}
for command in cargo cargo-zigbuild pnpm ssh scp tar file md5; do
  command -v "$command" >/dev/null || { printf 'error: missing command: %s\n' "$command" >&2; exit 127; }
done

repo_root=$(cd "$(dirname "$0")/../../../.." && pwd -P)
cd "$repo_root"
git status --short
commit=$(git rev-parse --short HEAD)
branch=$(git branch --show-current)
version=$(tr -d '[:space:]' < VERSION)
stage_local=$(mktemp -d /tmp/simadmin-dev-deploy.XXXXXX)
trap 'rm -rf "$stage_local"' EXIT

printf 'building frontend\n'
(cd frontend && pnpm install --frozen-lockfile && pnpm run build)

printf 'building backend for x86_64 Linux\n'
CARGO_TARGET_DIR="$stage_local/target" \
  cargo zigbuild --locked --release --target x86_64-unknown-linux-musl --manifest-path backend/Cargo.toml
binary="$stage_local/target/x86_64-unknown-linux-musl/release/simadmin"
www="$stage_local/www"
cp "$binary" "$stage_local/simadmin"
cp -R frontend/dist "$www"
file "$stage_local/simadmin" | grep -q 'ELF 64-bit.*x86-64' || {
  printf '%s\n' 'error: expected an x86-64 Linux ELF binary' >&2; exit 1
}

binary_md5=$(md5 -q "$stage_local/simadmin")
frontend_md5=$(find "$www" -type f -exec md5 -q {} \; | sort | md5 -q)
build_time=$(TZ=Asia/Shanghai date +%Y-%m-%dT%H:%M:%S+08:00)
printf '{\n  "version": "%s",\n  "commit": "%s",\n  "build_time": "%s",\n  "binary_md5": "%s",\n  "frontend_md5": "%s",\n  "arch": "x86_64-unknown-linux-musl"\n}\n' \
  "$version" "$commit" "$build_time" "$binary_md5" "$frontend_md5" > "$stage_local/meta.json"

printf 'commit=%s branch=%s target=%s root=%s service=%s\n' "$commit" "$branch" "$host" "$remote_root" "$service"
if "$dry_run"; then
  printf '%s\n' 'dry run: build and artifact validation passed; NAS was not contacted'
  exit 0
fi

ssh -o BatchMode=yes -o ConnectTimeout=8 "$host" "set -eu
  test \"\$(uname -m)\" = x86_64
  command -v systemctl >/dev/null
  command -v curl >/dev/null
  command -v mmcli >/dev/null
  test -d '$remote_root'
  systemctl is-active --quiet '$service'
  systemctl is-active --quiet ModemManager
  ss -ltnp | grep -Eq '(:3000[[:space:]]|:3000\$)'
  pgrep -x simadmin >/dev/null"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
remote_stage="$remote_root/.deploy-$commit-$stamp"
backup="$remote_root/.rollback-$commit-$stamp"
ssh -o BatchMode=yes "$host" "set -eu; test ! -e '$remote_stage'; test ! -e '$backup'; mkdir -p '$remote_stage' '$backup'"
scp -q "$stage_local/simadmin" "$stage_local/meta.json" "$host:$remote_stage/"
tar -C "$www" -cf - . | ssh -o BatchMode=yes "$host" "mkdir -p '$remote_stage/www'; tar -C '$remote_stage/www' -xf -"

ssh -o BatchMode=yes "$host" bash -s -- "$remote_root" "$remote_stage" "$backup" "$service" "$health_url" <<'REMOTE_SCRIPT'
set -euo pipefail
root=$1
stage=$2
backup=$3
service=$4
health_url=$5

rollback() {
  printf '%s\n' 'deployment failed; restoring prior artifacts' >&2
  systemctl stop "$service" || true
  rm -f "$root/simadmin" "$root/meta.json"
  rm -rf "$root/www"
  mv "$backup/simadmin" "$root/simadmin"
  mv "$backup/meta.json" "$root/meta.json"
  mv "$backup/www" "$root/www"
  systemctl start "$service" || true
}

mv "$root/simadmin" "$backup/simadmin"
mv "$root/meta.json" "$backup/meta.json"
mv "$root/www" "$backup/www"
mv "$stage/simadmin" "$root/simadmin"
mv "$stage/meta.json" "$root/meta.json"
mv "$stage/www" "$root/www"
chmod 0755 "$root/simadmin"

if ! systemctl restart "$service"; then
  rollback
  exit 1
fi
for _attempt in $(seq 1 15); do
  if curl -fsS "$health_url" >/dev/null; then
    printf 'deployment=healthy\nrollback_backup=%s\n' "$backup"
    exit 0
  fi
  sleep 1
done
rollback
exit 1
REMOTE_SCRIPT
