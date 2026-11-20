/**
 * The dashboard's one signature moment (the Medify census drawing in on the morning brief) plays once per tab session.
 * `ENTRANCE_SCRIPT` runs inline before first paint (app/layout.tsx) and sets `data-entrance` on <html>: "play" until the
 * moment has been seen in this tab, "seen" afterwards. With storage blocked the attribute stays unset and nothing animates.
 * Plain module on purpose: the layout is a server component and cannot read a constant out of a "use client" file.
 */
export const ENTRANCE_KEY = "melindaos-brief-entrance";
export const ENTRANCE_SCRIPT = `try{document.documentElement.dataset.entrance=sessionStorage.getItem("${ENTRANCE_KEY}")?"seen":"play"}catch(e){}`;
