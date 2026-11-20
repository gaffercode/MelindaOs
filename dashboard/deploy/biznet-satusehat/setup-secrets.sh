#!/usr/bin/env bash
# Ask for SATUSEHAT OAuth2 credentials without echoing secrets and write to /etc/melindaos/satusehat.env.
set -euo pipefail
ENV=/etc/melindaos/satusehat.env
[[ $EUID -eq 0 ]] || { echo "Jalankan dengan sudo." >&2; exit 1; }
[[ -f $ENV ]] || { echo "$ENV belum ada; jalankan install.sh dulu." >&2; exit 1; }
setv() { local key=$1 val=$2 tmp; tmp=$(mktemp); grep -v "^$key=" "$ENV" > "$tmp" || true; printf '%s=%s\n' "$key" "$val" >> "$tmp"; install -m 0640 -o root -g melindaos "$tmp" "$ENV"; rm -f "$tmp"; }
read -rp  "SATUSEHAT Organization ID (mis. 100027810): " org_id
read -rp  "SATUSEHAT Client ID: " client_id
read -rsp "SATUSEHAT Client Secret (tidak tampil): " client_secret; echo
[[ -n $org_id && -n $client_id && -n $client_secret ]] || { echo "Ada isian kosong, tidak disimpan." >&2; exit 1; }
setv SATUSEHAT_ORG_ID "$org_id"
setv SATUSEHAT_CLIENT_ID "$client_id"
setv SATUSEHAT_CLIENT_SECRET "$client_secret"
echo "Tersimpan di $ENV."
