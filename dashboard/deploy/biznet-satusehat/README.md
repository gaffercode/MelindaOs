# SATUSEHAT OAuth2 scheduler on Biznet Gio

Menarik jumlah agregat 19 resource FHIR resmi dari Kemenkes SATUSEHAT OAuth2 API (`_summary=count`, tanpa CAPTCHA dan tanpa data pasien) dua kali sehari pukul **05:55** dan **17:55 WIB**, lalu mengirimkannya ke dashboard MelindaOS sebagai `satusehat_snapshot`.

Jadwal ini sengaja 5 menit sebelum tarikan Medify (06:00 dan 18:00 WIB), sehingga Morning Brief yang disusun otomatis setelah snapshot Medify masuk sudah memuat angka SATUSEHAT hari yang sama. Di `melindaos.app` jadwal yang sama sudah berjalan lewat Vercel Cron (`vercel.json` → `GET /api/cron/satusehat`); kit Biznet ini hanya cadangan opsional.

| Komponen | Nilai |
|---|---|
| Jadwal | 05:55 dan 17:55 Asia/Jakarta (`melindaos-satusehat-morning.timer`, `melindaos-satusehat-evening.timer`) |
| Runner | `/opt/melindaos-satusehat/run-satusehat-scheduled.mjs <morning\|evening>` |
| Rahasia | `/etc/melindaos/satusehat.env` (mode 0640, tidak masuk Git) |
| Keamanan | Hanya meminta token `client_credentials` + `_summary=count` (tidak membaca `entry` pasien) |

## Pemasangan

```bash
cd MelindaOs/dashboard
sudo bash deploy/biznet-satusehat/install.sh
sudo melindaos-satusehat-setup
sudo systemctl start melindaos-satusehat@morning.service
journalctl -u melindaos-satusehat@morning.service -n 30 --no-pager
```

Pasang hasil SHA-256 kunci publisher ke Vercel sebagai `MELINDAOS_SATUSEHAT_PUBLISHER_TOKEN_HASH` (atau pakai `MELINDAOS_MEDIFY_PUBLISHER_TOKEN_HASH` bila berbagi token dari server Biznet yang sama).
