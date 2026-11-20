export const WELCOME_HEADLINE = "Connecting hospital knowledge with the daily work and decisions that shape patient care.";

/** Slogan. One text node (no per-word spans) so assistive tech reads it as one sentence;
 * the timeline lifts it in as a block after the logo settles. */
export function WelcomeMessage() {
  return <h1 className="entrance-welcome" data-entrance="welcome" style={{ opacity: 0 }}>{WELCOME_HEADLINE}</h1>;
}
