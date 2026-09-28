const AVATAR_COLORS = ['#0c66e4', '#1f845a', '#c25100', '#c9372c', '#6e5dc6', '#227d9b', '#ae4787', '#946f00', '#5b7f24', '#626f86'];

/** Stable per-user color, so the same person looks the same in every avatar. */
export function avatarStyle(userId: string | undefined): Record<string, string> {
  if (!userId) return {};
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return { background: AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length], color: '#ffffff' };
}

// First+last initials from the display name (mandatory since 2026-09-24); falls back to
// the email's first letter for the handful of accounts that predate that requirement.
export function initials(displayName: string | null | undefined, email: string): string {
  const parts = displayName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return email.charAt(0).toUpperCase();
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}
