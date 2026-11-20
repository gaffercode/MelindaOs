"use client";
import { Children, cloneElement, Component, isValidElement, type ReactElement, type ReactNode } from "react";
import { MOTION, reducedMotion } from "./motion";

type RowProps = { ref?: (element: HTMLElement | null) => void; inert?: boolean };
type Row = ReactElement<RowProps>;
type Props = { children: ReactNode; glide?: boolean; fadeIn?: boolean };
type State = { rows: Row[]; leaving: ReadonlySet<string>; children: ReactNode };
type Boxes = Map<string, DOMRect>;

const NONE: ReadonlySet<string> = new Set();
const EASE = "cubic-bezier(0.2, 0, 0, 1)";
const EASE_IN = "cubic-bezier(0.4, 0, 1, 1)";

function rowsOf(children: ReactNode): Row[] {
  const rows: Row[] = [];
  for (const child of Children.toArray(children)) if (isValidElement<RowProps>(child) && child.key !== null) rows.push(child);
  return rows;
}

/**
 * A list whose rows glide: a row that leaves fades out first, then the rows that stay move from where they were to where
 * they are now (FLIP, transform only), and with `fadeIn` a new row fades in. Children are keyed DOM elements without a ref
 * of their own. `glide={false}` (long lists) and reduced motion make it a plain list.
 *
 * Written on the Web Animations API, not Motion's `AnimatePresence` and `layout`: with those in a page component Turbopack
 * copied shared modules into several chunks, about 80 KB of extra JavaScript. A class, because the place of each row has to
 * be read before React changes the page (`getSnapshotBeforeUpdate`), which also makes a change that arrives mid-glide start
 * from the place on screen.
 */
export class GlideList extends Component<Props, State> {
  state: State = { rows: rowsOf(this.props.children), leaving: NONE, children: this.props.children };
  private elements = new Map<string, HTMLElement>();
  // Not `refs`: React assigns its own legacy `refs` object to every class instance.
  private rowRefs = new Map<string, (element: HTMLElement | null) => void>();
  private glides = new Map<string, Animation>();
  private fades = new Map<string, Animation>();
  private timer: number | undefined;

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.children === state.children) return null;
    const next = rowsOf(props.children);
    const fresh = new Map(next.map((row) => [row.key, row]));
    const gone = state.rows.filter((row) => !fresh.has(row.key));
    if (gone.length === 0 || props.glide === false || reducedMotion()) return { rows: next, leaving: NONE, children: props.children };
    // Leaving rows stay where they are while they fade; rows that stay take their new content; new rows wait for the leavers.
    return { rows: state.rows.map((row) => fresh.get(row.key) ?? row), leaving: new Set(gone.map((row) => String(row.key))), children: props.children };
  }

  private animated() {
    return this.props.glide !== false && !reducedMotion();
  }

  /** One ref callback per key for as long as the row exists, so React does not detach and re-attach it on every render. */
  private refFor(key: string) {
    let ref = this.rowRefs.get(key);
    if (!ref) {
      ref = (element) => { if (element) this.elements.set(key, element); else this.elements.delete(key); };
      this.rowRefs.set(key, ref);
    }
    return ref;
  }

  private stopAll() {
    for (const fade of this.fades.values()) fade.cancel();
    for (const glide of this.glides.values()) glide.cancel();
    this.fades.clear(); this.glides.clear();
  }

  /** Forgets rows that are gone. Their animations end with the element. */
  private prune() {
    const live = new Set(this.state.rows.map((row) => String(row.key)));
    for (const map of [this.rowRefs, this.glides, this.fades]) for (const key of [...map.keys()]) if (!live.has(key)) map.delete(key);
  }

  getSnapshotBeforeUpdate(): Boxes | null {
    if (!this.animated()) return null;
    return new Map([...this.elements].map(([key, element]) => [key, element.getBoundingClientRect()]));
  }

  componentDidUpdate(_props: Props, previous: State, before: Boxes | null) {
    const { leaving } = this.state;
    // Every row that starts to leave gets the whole fade: a later leaver restarts the clock for all of them.
    if (leaving.size > 0 && (this.timer === undefined || [...leaving].some((key) => !previous.leaving.has(key)))) {
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => { this.timer = undefined; this.setState({ rows: rowsOf(this.props.children), leaving: NONE }); }, MOTION.exit * 1000);
    }
    // Gliding was switched off (long list, reduced motion): nothing may be left half faded or half moved.
    if (!before) { this.stopAll(); this.prune(); return; }
    // Writes, then reads, then writes: a running glide is dropped so each row can be measured at rest in one layout pass.
    for (const [key, glide] of this.glides) { if (!leaving.has(key)) glide.cancel(); }
    const plans: (() => void)[] = [];
    for (const [key, element] of this.elements) {
      if (typeof element.animate !== "function") continue;
      if (leaving.has(key)) {
        if (!this.fades.has(key)) plans.push(() => this.fades.set(key, element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: MOTION.exit * 1000, easing: EASE_IN, fill: "forwards" })));
        continue;
      }
      const fade = this.fades.get(key);
      if (fade) { this.fades.delete(key); plans.push(() => fade.cancel()); }
      const old = before.get(key);
      if (!old) {
        if (this.props.fadeIn) plans.push(() => element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: MOTION.exit * 1000, easing: EASE }));
        continue;
      }
      const now = element.getBoundingClientRect();
      const x = old.left - now.left, y = old.top - now.top;
      if (x !== 0 || y !== 0) plans.push(() => this.glides.set(key, element.animate([{ transform: `translate(${x}px, ${y}px)` }, { transform: "none" }], { duration: MOTION.layout * 1000, easing: EASE })));
    }
    for (const plan of plans) plan();
    this.prune();
  }

  componentWillUnmount() {
    window.clearTimeout(this.timer);
    this.timer = undefined;
  }

  render() {
    return this.state.rows.map((row) => { const key = String(row.key); return cloneElement(row, { ref: this.refFor(key), inert: this.state.leaving.has(key) || undefined }); });
  }
}
