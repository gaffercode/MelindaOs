import { fileModeWarning } from "@/lib/director/director-auth";

/** Server component: a permanent warning when the site runs without a login (local file mode). */
export function LocalModeBanner() {
  const warning = fileModeWarning();
  if (!warning) return null;
  return (
    <div
      role="alert"
      style={{
        padding: "8px 16px",
        fontSize: "14px",
        fontWeight: 600,
        color: "#8a3d24",
        background: "#fdeee8",
        borderBottom: "1px solid #e8c9bf",
        textAlign: "center",
      }}
    >
      {warning}
    </div>
  );
}
