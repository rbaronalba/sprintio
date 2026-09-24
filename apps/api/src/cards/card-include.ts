// Shared by cards.service (create) and lists.service (list) so both card payloads match.
export const CARD_FACE_INCLUDE = {
  assignees: true,
  labels: true,
  timeEntries: { select: { hours: true } },
  checklist: { select: { done: true } },
  _count: { select: { comments: true, attachments: true } },
} as const;
