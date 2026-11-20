# n8n role
n8n adalah integration/event runner, **bukan otak agent** dan tidak perlu memegang provider tokens. Idealnya n8n hanya memanggil MAAF backend menggunakan satu workload credential yang dikelola secret manager.

Import workflow JSON, bind credential MAAF API di instance, set `MAAF_BACKEND_URL`, lalu aktifkan setelah testing. Jalankan n8n security audit berkala dan batasi risky/community nodes.
