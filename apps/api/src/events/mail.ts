import { createTransport } from 'nodemailer';

/**
 * Email for the few events worth leaving the app for. Off unless SMTP_URL is set
 * (e.g. smtp://user:pass@smtp.office365.com:587), so dev and tests send nothing.
 */
const transport = process.env.SMTP_URL ? createTransport(process.env.SMTP_URL) : null;
const FROM = process.env.MAIL_FROM ?? 'Sprintio <sprintio@localhost>';

export const mailEnabled = transport !== null;

/** Subject line for an event, or null when that event type is not emailed. */
export function mailSubject(type: string, actor: string, data: Record<string, unknown>): string | null {
  const card = `"${String(data.title ?? '')}"`;
  switch (type) {
    case 'CARD_ASSIGNED':
      return `${actor} te ha asignado a ${card}`;
    case 'CARD_UNASSIGNED':
      return `${actor} te ha quitado de ${card}`;
    case 'CARD_MOVED':
      return `${actor} ha movido ${card} de ${String(data.from)} a ${String(data.to)}`;
    default:
      return null;
  }
}

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  await transport?.sendMail({ from: FROM, to, subject, text });
}
