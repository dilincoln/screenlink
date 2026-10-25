// Whether a newer release is out on GitHub. Only tells: the user downloads the installer from the
// release page, so deb, pacman, AppImage and both Windows builds all work the same way.

export const RELEASES_API = "https://api.github.com/repos/dilincoln/screenlink/releases/latest";
export const RELEASES_PAGE = "https://github.com/dilincoln/screenlink/releases/";

/** [major, minor, patch] from "0.4.1" or "v0.4.1"; null for anything else. */
function parse(version) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version).trim());
  return m ? m.slice(1).map(Number) : null;
}

/** Whether `tag` ("v0.4.2") is a later version than `current` ("0.4.1"). */
export function isNewer(tag, current) {
  const a = parse(tag);
  const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/**
 * The update on offer given GitHub's "latest release" response, or null. The link is only kept when
 * it points at this repository's releases, since the app opens it in the browser.
 * @param {{ tag_name?: string, html_url?: string }} release
 */
export function availableUpdate(release, current) {
  if (!release?.tag_name || !isNewer(release.tag_name, current)) return null;
  const url = String(release.html_url ?? "").startsWith(RELEASES_PAGE) ? release.html_url : RELEASES_PAGE;
  return { version: release.tag_name.replace(/^v/, ""), url };
}
