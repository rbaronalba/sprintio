/** Board/list background: '' (none), a palette color, or an /uploads/ image URL (the API allows nothing else). */
export function backgroundStyle(background: string | undefined): Record<string, string> {
  if (!background) return {};
  return background.startsWith('/uploads/')
    ? { background: `center / cover no-repeat url("${background}")` }
    : { background };
}
