# Rare UI components

These files come from [Rare UI](https://rareui.com) by Swami Malode and were installed with the documented shadcn CLI path
(`npx shadcn@latest add swamimalode07/rare-ui/<name>`, registry `@rare-ui` in `components.json`). The CLI also installed
`cn` (its current `clsx` + `tailwind-merge` replacement, exported from `lib/utils.ts`), `@radix-ui/react-slot`, `sonner`,
`figma-squircle` and `react-use-measure`; `motion` was already a dependency.

## License

MIT + Commons Clause License Condition v1.0 + Attribution, Copyright (c) 2026 Swami Malode. MelindaOS credits Rare UI with a
visible link in the dashboard sidebar footer and in `README.md`; the components are used inside this application only and are
never redistributed on their own.

## Installed files (sha256 of the registry content, LF line endings, before the attribution header was added)

| Component | Registry item | sha256 |
|---|---|---|
| `animated-counter.tsx` | `animated-counter.json` | `7913a4e43d8ad16ebac5fe4ea2413890866f14b9a0e01f7feec2b912e399906c` |
| `notification-bell.tsx` | `notification-bell.json` | `ca60cfe34fb80cf90d20904fc5723439577bc88e9a28ffb02a0ccab393489100` |
| `toast.tsx` | `toast.json` | `722a38460cf914b0566fe660ba3a9d0cdc92014071b0beb40af2b6dc493454ff` |
| `ai-status.tsx` | `ai-status.json` | `58d1a6ac343bc0d5e7d2edb4cd558c84a053599652653649e9543289ebeb8661` |
| `scroll-progress.tsx` | `scroll-progress.json` | `11f05b3649183a4183e441f52f61eeae77b703b14d4f17178ddf42bc982bd06c` |

## Local edits

- `notification-bell.tsx`: the sr-only status text is Indonesian (`Notifikasi, N belum ditangani`) and the `red` badge colour is the Sentra `--color-status-critical` token instead of the iOS red.

- `scroll-progress.tsx`: the label crossfade version is `useState` derived in render instead of two refs read during render, which the repo's `react-hooks/refs` lint rule (eslint-config-next 16) rejects. Same behaviour. The pill's `aria-label` is Indonesian (`Tampilkan bagian laporan`).

- `animated-counter.tsx`, `ai-status.tsx`, `scroll-progress.tsx` (2026-11-11, Director's decision A in the motion plan): spring `bounce` set to 0 (was 0.18; 0.15 and 0.35; 0.16). The dashboard's motion rule is no bounce or elastic; durations and everything else are unchanged.

Nothing else inside the component bodies. Styling is applied through props and `className`; the shadcn colour names the sources use
(`foreground`, `background`, `border`, `ring`, `muted-foreground`) are mapped onto the Sentra tokens in `app/globals.css`, and the
`dark:` variant is bound to `[data-theme="dark"]` there so the sources never follow the OS colour scheme.
