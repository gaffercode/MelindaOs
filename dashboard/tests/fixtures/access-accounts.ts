import type { AccountRole } from "@/lib/access/access-store";

/** Synthetic test accounts. The password is `synthetic-<local part>-example`. */
export const ACCESS_FIXTURES: readonly { email: string; role: AccountRole; displayName: string; password: string }[] = [
  { email: "vicedirector@melinda.test", role: "VICE_DIRECTOR", displayName: "Wakil Direktur Uji", password: "synthetic-vicedirector-example" },
  { email: "staff.finance@melinda.test", role: "STAFF_FINANCE", displayName: "Staf Keuangan Uji", password: "synthetic-staff.finance-example" },
  { email: "staff.hr@melinda.test", role: "STAFF_HR", displayName: "Staf SDM Uji", password: "synthetic-staff.hr-example" },
  { email: "staff.ops@melinda.test", role: "STAFF_OPS", displayName: "Staf Operasional Uji", password: "synthetic-staff.ops-example" },
  { email: "staff.support@melinda.test", role: "STAFF_SUPPORT", displayName: "Staf Layanan Uji", password: "synthetic-staff.support-example" },
];

export const DIRECTOR_FIXTURE_PASSCODE = "synthetic-test-passcode";
