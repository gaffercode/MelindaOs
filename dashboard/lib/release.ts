import packageJson from "../package.json";

/** Shown in the sidebar and on the error page, so testers know this is a trial build and can quote its version. */
export const RELEASE_LABEL = `Versi beta ${packageJson.version}`;
