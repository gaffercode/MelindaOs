#!/usr/bin/env bash
# Install or update the MelindaOS SATUSEHAT OAuth2 scheduler on a Linux server with systemd.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Jalankan sebagai root (sudo)." >&2; exit 1; fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD="$(cd "$HERE/../.." && pwd)"
APP_DIR=/opt/melindaos-satusehat
ENV_DIR=/etc/melindaos
ENV_FILE="$ENV_DIR/satusehat.env"
SCRIPTS=(satusehat-pull.mjs run-satusehat-scheduled.mjs daily-publisher-client.mjs)

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then echo "Node.js belum terpasang (butuh versi 20 atau lebih baru)." >&2; exit 1; fi
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then echo "Node.js $NODE_MAJOR terlalu lama; butuh 20 atau lebih baru." >&2; exit 1; fi
case "$NODE_BIN" in /root/*|/home/*) echo "Node.js ada di folder pengguna ($NODE_BIN); pasang Node.js sistem (mis. /usr/bin/node)." >&2; exit 1;; esac

id -u melindaos >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin melindaos

install -d -m 0755 "$APP_DIR"
for script in "${SCRIPTS[@]}"; do install -m 0644 "$DASHBOARD/scripts/$script" "$APP_DIR/$script"; done

install -d -m 0750 -o root -g melindaos "$ENV_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0640 -o root -g melindaos "$HERE/satusehat.env.example" "$ENV_FILE"
  echo "Dibuat: $ENV_FILE — isi SATUSEHAT_ORG_ID, SATUSEHAT_CLIENT_ID, SATUSEHAT_CLIENT_SECRET, MELINDAOS_DASHBOARD_URL, MELINDAOS_PUBLISHER_TOKEN."
fi

if ! grep -qE '^MELINDAOS_PUBLISHER_TOKEN=.+' "$ENV_FILE"; then
  KEY="$(openssl rand -hex 32)"
  sed -i "s#^MELINDAOS_PUBLISHER_TOKEN=.*#MELINDAOS_PUBLISHER_TOKEN=$KEY#" "$ENV_FILE"
  echo "Kunci pengirim baru dibuat. Pasang hash ini di Vercel sebagai MELINDAOS_SATUSEHAT_PUBLISHER_TOKEN_HASH:"
  printf '%s' "$KEY" | sha256sum | cut -d' ' -f1
  unset KEY
fi
install -m 0750 -o root -g root "$HERE/setup-secrets.sh" /usr/local/sbin/melindaos-satusehat-setup

sed "s#@NODE_BIN@#$NODE_BIN#" "$HERE/melindaos-satusehat@.service" > /etc/systemd/system/melindaos-satusehat@.service
install -m 0644 "$HERE/melindaos-satusehat-morning.timer" /etc/systemd/system/melindaos-satusehat-morning.timer
install -m 0644 "$HERE/melindaos-satusehat-evening.timer" /etc/systemd/system/melindaos-satusehat-evening.timer

systemctl daemon-reload
systemctl enable --now melindaos-satusehat-morning.timer melindaos-satusehat-evening.timer
systemctl list-timers 'melindaos-satusehat-*' --no-pager
echo "Selesai. Tes sekali: sudo systemctl start melindaos-satusehat@morning.service && journalctl -u melindaos-satusehat@morning.service -n 30 --no-pager"
