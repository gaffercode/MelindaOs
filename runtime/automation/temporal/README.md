# Temporal — Optional Durability Layer
Gunakan hanya untuk workflow yang benar-benar mission-critical dan panjang: claim resolution multi-day, token recovery berjenjang, cross-system reconciliation, atau workflow yang harus survive outage/restart tanpa kehilangan state.

Tidak perlu memasukkan seluruh automation ke Temporal pada fase pertama. n8n + idempotent MAAF cukup untuk mayoritas workflow. Temporal masuk ketika failure semantics dan durability menjadi kebutuhan nyata.
