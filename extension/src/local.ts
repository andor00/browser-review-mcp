/** True for the pages the overlay runs on (same as the content_scripts matches in the manifest). */
export function isLocalUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}
