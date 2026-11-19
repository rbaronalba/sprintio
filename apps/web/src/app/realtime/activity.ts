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

type Data = Record<string, unknown>;
type Describe = (d: Data, card: string, list: string) => string;

const DESCRIPTIONS: Record<string, Describe> = {
  CARD_CREATED: (_d, card, list) => `añadió ${card} a ${list}`,
  CARD_MOVED: (d, card) =>
    `movió ${card} de ${str(d, 'from')} a ${str(d, 'to')}`,
  CARD_UPDATED: (_d, card) => `actualizó ${card}`,
  CARD_DELETED: (_d, card) => `eliminó ${card}`,
  CARD_ASSIGNED: (_d, card) => `te asignó a ${card}`,
  CARD_UNASSIGNED: (_d, card) => `quitó a un asignado de ${card}`,
  LABEL_ADDED: (d, card) =>
    `añadió la etiqueta ${str(d, 'labelName')} a ${card}`,
  LABEL_REMOVED: (d, card) =>
    `quitó la etiqueta ${str(d, 'labelName')} de ${card}`,
  COMMENT_ADDED: (d, card) => `comentó en ${card}: ${str(d, 'excerpt')}`,
  COMMENT_DELETED: (_d, card) => `eliminó un comentario en ${card}`,
  ATTACHMENT_ADDED: (d, card) => `adjuntó ${str(d, 'name')} a ${card}`,
  ATTACHMENT_DELETED: (d, card) => `quitó ${str(d, 'name')} de ${card}`,
  TIME_LOGGED: (d, card) => `registró ${d['hours']}h en ${card}`,
  CHECKLIST_ADDED: (_d, card) => `añadió un elemento al checklist de ${card}`,
  CHECKLIST_TOGGLED: (d, card) =>
    `${d['done'] ? 'marcó' : 'desmarcó'} un elemento del checklist de ${card}`,
  CHECKLIST_DELETED: (_d, card) => `quitó un elemento del checklist de ${card}`,
  LIST_CREATED: (_d, _card, list) => `añadió la lista ${list}`,
  LIST_UPDATED: (d, _card, list) => `renombró ${str(d, 'from')} a ${list}`,
  LIST_DELETED: (_d, _card, list) => `eliminó la lista ${list}`,
  BOARD_RENAMED: (d) =>
    `renombró el tablero ${str(d, 'from')} a ${str(d, 'boardTitle')}`,
  OWNER_CHANGED: (d) =>
    `hizo a ${str(d, 'email')} administrador de ${str(d, 'boardTitle')}`,
  BOARD_CREATED: (d) => `creó ${str(d, 'boardTitle')}`,
  MEMBER_JOINED: (d) => `se unió a ${str(d, 'boardTitle')}`,
  MEMBER_REMOVED: (d) =>
    d['left']
      ? `salió de ${str(d, 'boardTitle')}`
      : `quitó a ${str(d, 'email')} de ${str(d, 'boardTitle')}`,
};

/**
 * One sentence per event, shared by the activity feed and the notification bell so
 * the same event never reads two different ways.
 */
export function describeEvent(event: ActivityLike): string {
  const d = event.data ?? {};
  const describe = DESCRIPTIONS[event.type];
  // A new server event type should read as something, not vanish.
  if (!describe) return event.type.toLowerCase().replace(/_/g, ' ');
  return describe(d, str(d, 'title'), str(d, 'listTitle'));
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
  return new Intl.RelativeTimeFormat('es', { numeric: 'auto' }).format(
    -Math.round(value),
    unit,
  );
}
