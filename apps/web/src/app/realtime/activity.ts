export interface ActivityActor {
  email: string;
  displayName?: string | null;
}

export interface ActivityLike {
  type: string;
  data: Record<string, unknown>;
}

export function actorName(actor: ActivityActor | null | undefined): string {
  if (!actor) return 'Someone';
  return actor.displayName?.trim() || actor.email;
}

const str = (data: Record<string, unknown>, key: string): string => {
  const value = data[key];
  return typeof value === 'string' ? value : '';
};

/**
 * One sentence per event, shared by the activity feed and the notification bell so
 * the same event never reads two different ways.
 */
export function describeEvent(event: ActivityLike): string {
  const d = event.data ?? {};
  const card = str(d, 'title');
  const list = str(d, 'listTitle');

  switch (event.type) {
    case 'CARD_CREATED':
      return `added ${card} to ${list}`;
    case 'CARD_MOVED':
      return `moved ${card} from ${str(d, 'from')} to ${str(d, 'to')}`;
    case 'CARD_UPDATED':
      return `updated ${card}`;
    case 'CARD_DELETED':
      return `deleted ${card}`;
    case 'CARD_ASSIGNED':
      return `assigned you to ${card}`;
    case 'CARD_UNASSIGNED':
      return `removed an assignee from ${card}`;
    case 'LABEL_ADDED':
      return `added the ${str(d, 'labelName') || 'label'} label to ${card}`;
    case 'LABEL_REMOVED':
      return `removed the ${str(d, 'labelName') || 'label'} label from ${card}`;
    case 'COMMENT_ADDED':
      return `commented on ${card}: ${str(d, 'excerpt')}`;
    case 'COMMENT_DELETED':
      return `deleted a comment on ${card}`;
    case 'ATTACHMENT_ADDED':
      return `attached ${str(d, 'name')} to ${card}`;
    case 'ATTACHMENT_DELETED':
      return `removed ${str(d, 'name')} from ${card}`;
    case 'TIME_LOGGED':
      return `logged ${d['hours']}h on ${card}`;
    case 'CHECKLIST_ADDED':
      return `added a checklist item to ${card}`;
    case 'CHECKLIST_TOGGLED':
      return `${d['done'] ? 'checked' : 'unchecked'} a checklist item on ${card}`;
    case 'CHECKLIST_DELETED':
      return `removed a checklist item from ${card}`;
    case 'LIST_CREATED':
      return `added the list ${list}`;
    case 'LIST_UPDATED':
      return `renamed ${str(d, 'from')} to ${list}`;
    case 'LIST_DELETED':
      return `deleted the list ${list}`;
    case 'MEMBER_JOINED':
      return `joined ${str(d, 'boardTitle')}`;
    case 'MEMBER_REMOVED':
      return d['left']
        ? `left ${str(d, 'boardTitle')}`
        : `removed ${str(d, 'email')} from ${str(d, 'boardTitle')}`;
    default:
      // A new server event type should read as something, not vanish.
      return event.type.toLowerCase().replace(/_/g, ' ');
  }
}

export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  // [how many of the current unit make one of the next, what the next unit is]
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'hour'],
    [24, 'day'],
    [7, 'week'],
    [4.35, 'month'],
    [12, 'year'],
  ];
  let value = seconds / 60;
  let unit: Intl.RelativeTimeFormatUnit = 'minute';
  for (const [size, next] of units) {
    if (Math.abs(value) < size) break;
    value /= size;
    unit = next;
  }
  return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-Math.round(value), unit);
}
