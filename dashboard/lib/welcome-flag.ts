/**
 * The welcome shown once after a successful Director sign-in. Sign-in ends in a full page load, so the welcome has to
 * cross from the login document to the destination document: the login page stores the start time (epoch ms) under
 * `WELCOME_KEY`, and `WELCOME_SCRIPT` runs inline in the destination's <head> (app/layout.tsx), puts the same white
 * veil back before anything is painted and tells CSS how far the text's fade already is. The text itself is the
 * `data-welcome-text` attribute the layout puts on <html>. The key is read once and removed, so a reload
 * shows no welcome. Stale flags and a sign-in that bounced back to the login page are ignored.
 * The script also asks for the text's font at once (the stylesheet is already in by then), so the line is not drawn in
 * a fallback face first, and it sets a last-resort timer that drops the veil even if the page's scripts never run.
 * Plain module on purpose: the layout is a server component and cannot read a constant out of a "use client" file.
 */
export const WELCOME_KEY = "melindaos-welcome";
export const WELCOME_TEXT = "Selamat datang dr Ferdi Andriska, our Director";
/** Timings in ms. The fades themselves are CSS (globals.css, "Welcome after Director sign-in"); keep both in step. */
export const WELCOME = { formOut: 220, textIn: 420, read: 1350, textOut: 180, veilOut: 480, settle: 200, cap: 8000, failsafe: 10000, maxAge: 15000 } as const;
export const WELCOME_SCRIPT = `try{var w=sessionStorage.getItem("${WELCOME_KEY}");if(w){sessionStorage.removeItem("${WELCOME_KEY}");var a=Date.now()-Number(w),h=document.documentElement;if(a>=0&&a<${WELCOME.maxAge}&&location.pathname!=="/director-login"){h.dataset.welcome="in";h.dataset.welcomeStart=w;h.style.setProperty("--welcome-elapsed",a+"ms");setTimeout(function(){if(h.dataset.welcomeStart===w){delete h.dataset.welcome;delete h.dataset.welcomeStart}},${WELCOME.failsafe});if(document.fonts)document.fonts.load('300 1em "Inter Variable"',h.dataset.welcomeText||"")}}}catch(e){}`;
