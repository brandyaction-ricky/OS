/** Keep authentication redirects on the current origin, including query and hash. */
export function safeLoginRedirect(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020\u007f]/.test(value)) return '/home';
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return '/home';
    const url = new URL(value, 'https://os.invalid');
    if (url.origin !== 'https://os.invalid' || url.pathname.startsWith('//')) return '/home';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch { return '/home'; }
}
