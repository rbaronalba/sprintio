export interface ActivityActor {
  email: string;
  displayName?: string | null;
}

export interface ActivityLike {
  type: string;
  data: Record<string, unknown>;
}

export function actorName(actor: ActivityActor | null | undefined): string {
  if (!actor) return 'Alguien';
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
      return `añadió ${card} a ${list}`;
    case 'CARD_MOVED':
      return `movió ${card} de ${str(d, 'from')} a ${str(d, 'to')}`;
    case 'CARD_UPDATED':
      return `actualizó ${card}`;
    case 'CARD_DELETED':
      return `eliminó ${card}`;
    case 'CARD_ASSIGNED':
      return `te asignó a ${card}`;
    case 'CARD_UNASSIGNED':
      return `quitó a un asignado de ${card}`;
    case 'LABEL_ADDED':
      return `añadió la etiqueta ${str(d, 'labelName')} a ${card}`;
    case 'LABEL_REMOVED':
      return `quitó la etiqueta ${str(d, 'labelName')} de ${card}`;
    case 'COMMENT_ADDED':
      return `comentó en ${card}: ${str(d, 'excerpt')}`;
    case 'COMMENT_DELETED':
      return `eliminó un comentario en ${card}`;
    case 'ATTACHMENT_ADDED':
      return `adjuntó ${str(d, 'name')} a ${card}`;
    case 'ATTACHMENT_DELETED':
      return `quitó ${str(d, 'name')} de ${card}`;
    case 'TIME_LOGGED':
      return `registró ${d['hours']}h en ${card}`;
    case 'CHECKLIST_ADDED':
      return `añadió un elemento al checklist de ${card}`;
    case 'CHECKLIST_TOGGLED':
      return `${d['done'] ? 'marcó' : 'desmarcó'} un elemento del checklist de ${card}`;
    case 'CHECKLIST_DELETED':
      return `quitó un elemento del checklist de ${card}`;
    case 'LIST_CREATED':
      return `añadió la lista ${list}`;
    case 'LIST_UPDATED':
      return `renombró ${str(d, 'from')} a ${list}`;
    case 'LIST_DELETED':
      return `eliminó la lista ${list}`;
    case 'BOARD_RENAMED':
      return `renombró el tablero ${str(d, 'from')} a ${str(d, 'boardTitle')}`;
    case 'OWNER_CHANGED':
      return `hizo a ${str(d, 'email')} administrador de ${str(d, 'boardTitle')}`;
    case 'BOARD_CREATED':
      return `creó ${str(d, 'boardTitle')}`;
    case 'MEMBER_JOINED':
      return `se unió a ${str(d, 'boardTitle')}`;
    case 'MEMBER_REMOVED':
      return d['left']
        ? `salió de ${str(d, 'boardTitle')}`
        : `quitó a ${str(d, 'email')} de ${str(d, 'boardTitle')}`;
    default:
      // A new server event type should read as something, not vanish.
      return event.type.toLowerCase().replace(/_/g, ' ');
  }
}

export function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'ahora mismo';
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
  return new Intl.RelativeTimeFormat('es', { numeric: 'auto' }).format(-Math.round(value), unit);
}
