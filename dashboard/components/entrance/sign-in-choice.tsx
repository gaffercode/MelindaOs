"use client";

export type SignInMode = "director" | "account";

const CHOICES: readonly { mode: SignInMode; label: string }[] = [{ mode: "director", label: "Direktur" }, { mode: "account", label: "Akun" }];

/** Two-way choice above the sign-in forms: the Director passcode (default) or an email-and-password account. It is
 * part of the entrance's field reveal, so it starts at opacity 0 like the passcode field does. */
export function SignInChoice({ mode, onChange }: { mode: SignInMode; onChange: (mode: SignInMode) => void }) {
  return (
    <div className="entrance-choice" role="group" aria-label="Masuk sebagai" data-entrance="field" style={{ opacity: 0 }}>
      {CHOICES.map(({ mode: value, label }) => (
        <button key={value} type="button" className="entrance-choice-button" aria-pressed={mode === value} onClick={() => onChange(value)}>{label}</button>
      ))}
    </div>
  );
}
