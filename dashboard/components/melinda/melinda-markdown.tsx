import type { ReactNode } from "react";

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

type ListState = { ordered: boolean; items: string[] };

/** The few Markdown shapes Melinda answers use: paragraphs, bullet and numbered lists, short headings, **bold** and `code`.
 * It builds React elements only (never HTML strings), so nothing in an answer can inject markup. */
export function MelindaMarkdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const open: { paragraph: string[]; list: ListState | null } = { paragraph: [], list: null };

  const closeParagraph = () => {
    if (open.paragraph.length) blocks.push(<p key={blocks.length}>{inline(open.paragraph.join("\n"))}</p>);
    open.paragraph = [];
  };
  const closeList = () => {
    const list = open.list;
    if (list) {
      const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
      blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    }
    open.list = null;
  };

  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.+)$/.exec(line);
    const heading = /^#{1,4}\s+(.+)$/.exec(line);
    const item = bullet ?? numbered;
    if (!line.trim()) { closeParagraph(); closeList(); }
    else if (item) {
      closeParagraph();
      const ordered = Boolean(numbered);
      if (open.list && open.list.ordered !== ordered) closeList();
      if (!open.list) open.list = { ordered, items: [] };
      open.list.items.push(item[1]);
    } else if (heading) { closeParagraph(); closeList(); blocks.push(<h3 key={blocks.length}>{inline(heading[1])}</h3>); }
    else { closeList(); open.paragraph.push(line); }
  }
  closeParagraph();
  closeList();
  return <>{blocks}</>;
}
