import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import type { MelindaBriefing } from "@/lib/melinda/briefing";

export const MELINDA_QUICK_ASKS = ["Ringkas ulang hari ini", "Apa yang paling mendesak?", "Siapa yang belum membalas tugas?"];

const Warn = ({ children }: { children: ReactNode }) => <p className="melinda-line text-[var(--warn)]">{children}</p>;
const Quiet = ({ children }: { children: ReactNode }) => <p className="melinda-line melinda-muted">{children}</p>;

/** A briefing card, like the cards on the other pages. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  return <section className="melinda-part"><h2>{title}</h2>{children}</section>;
}

function counts(waiting: number, overdue: number) {
  const parts = [waiting ? `${waiting} tugas menunggu` : "", overdue ? `${overdue} terlambat` : ""].filter(Boolean);
  return parts.length ? `${parts.join(", ")}.` : null;
}

/** The opening screen: the Director's day, already read, before anything is typed. */
export function MelindaBriefingView({ briefing, onAsk }: { briefing: MelindaBriefing; onAsk: (text: string) => void }) {
  const { schedule, tasks, attention } = briefing;
  const taskCounts = tasks.state === "ok" ? counts(tasks.waiting, tasks.overdue) : null;
  return <div className="melinda-welcome">
    <header className="melinda-hello">
      <Image src="/brand/melindaos-logo.png" alt="" width={56} height={57} unoptimized />
      <h1>{briefing.greeting}</h1>
      <p>{briefing.dateLabel}, {briefing.timeLabel}</p>
    </header>

    <div className="melinda-asks">{MELINDA_QUICK_ASKS.map((text) => <button key={text} type="button" onClick={() => onAsk(text)}>{text}</button>)}</div>

    <Part title="Jadwal hari ini">
      {schedule.state === "ok" && schedule.note && <Warn>{schedule.note}</Warn>}
      {schedule.state === "unavailable" ? <Warn>{schedule.message}</Warn>
        : schedule.items.length === 0 ? (!schedule.note && <Quiet>Belum ada jadwal hari ini.</Quiet>)
        : <ul className="melinda-list">{schedule.items.map((item) => <li key={`${item.start}-${item.title}`}>
          <Link href={item.href} className="melinda-row">
            <span className="melinda-clock">{item.start}{item.end ? `–${item.end}` : ""}</span>
            <span className="melinda-row-main">
              <span>{item.title}</span>
              {item.place && <span className="melinda-muted">{item.place}</span>}
            </span>
            {item.flag && <span className="melinda-flag text-[var(--warn)]">{item.flag}</span>}
          </Link>
        </li>)}</ul>}
    </Part>

    <Part title="Tugas hari ini">
      {tasks.state === "unavailable" ? <Warn>{tasks.message}</Warn> : <>
        {taskCounts && <p className="melinda-line">{taskCounts}</p>}
        {tasks.urgent.length === 0 ? <Quiet>Tidak ada tugas yang mendesak.</Quiet>
          : <ul className="melinda-list">{tasks.urgent.map((item) => <li key={item.id}>
            <Link href={item.href} className="melinda-row">
              <span className="melinda-row-main">
                <span>{item.title}</span>
                {item.note && <span className="melinda-muted">{item.note}</span>}
              </span>
            </Link>
          </li>)}</ul>}
      </>}
    </Part>

    <Part title="Perlu perhatian">
      {attention.state === "unavailable" ? <Warn>{attention.message}</Warn>
        : attention.items.length === 0 ? <Quiet>Tidak ada yang perlu perhatian.</Quiet>
        : <ul className="melinda-list">{attention.items.map((item) => <li key={item.text}>
          <Link href={item.href} className="melinda-row"><span className="melinda-row-main"><span>{item.text}</span></span></Link>
        </li>)}</ul>}
    </Part>
  </div>;
}
