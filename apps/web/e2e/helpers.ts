import { Browser, Page, expect } from '@playwright/test';

/**
 * Every run registers its own account, so tests never depend on data a previous run
 * left behind. Clean up with:
 *   DELETE FROM "User" WHERE email LIKE 'e2e-%@sprintio.test';
 */
export function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@sprintio.test`;
}

export const PASSWORD = 'e2e-password-123';

/** `name` is "First Last": the member picker shows people by name, so tests pick by it. */
export async function register(page: Page, email: string, name = 'Test Driver'): Promise<void> {
  const [first, last] = name.split(' ');
  await page.goto('/register');
  await page.locator('#firstName').fill(first);
  await page.locator('#lastName').fill(last);
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/home/);
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /iniciar sesión/i }).click();
  await expect(page).toHaveURL(/\/home/);
}

/** Creates a board from the header's Create dialog, which opens it. Returns its id from the URL. */
export async function createBoard(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: 'Crear tablero', exact: true }).click();
  await page.getByLabel('Título del tablero').fill(title);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(page).toHaveURL(/\/boards\/[^/]+$/);
  return new URL(page.url()).pathname.split('/').pop()!;
}

export async function addList(page: Page, title: string): Promise<void> {
  // Trello-style, the composer stays open after adding so you can keep going, which
  // means the trigger button is only on screen for the first list.
  const trigger = page.getByRole('button', { name: '+ Añadir otra lista' });
  if (await trigger.isVisible()) await trigger.click();
  await page.getByPlaceholder('Título de la lista').fill(title);
  await page.getByRole('button', { name: 'Añadir lista' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

export function listColumn(page: Page, title: string) {
  return page.locator('.list-col').filter({ has: page.getByRole('heading', { name: title }) });
}

export async function addCard(page: Page, listTitle: string, cardTitle: string): Promise<void> {
  const column = listColumn(page, listTitle);
  const trigger = column.getByRole('button', { name: '+ Añadir una tarjeta' });
  if (await trigger.isVisible()) await trigger.click();
  await column.getByPlaceholder('Título de la tarjeta').fill(cardTitle);
  await column.getByRole('button', { name: 'Añadir tarjeta' }).click();
  await expect(column.getByText(cardTitle, { exact: true })).toBeVisible();
}

/**
 * CDK drag-drop ignores a single instant mouse move, so the pointer is stepped across
 * the target to produce the intermediate move events it listens for. Resolves once the
 * move has been saved.
 */
export async function dragCardTo(page: Page, cardTitle: string, targetListTitle: string) {
  const card = page.locator('.card').filter({ hasText: cardTitle }).first();
  const target = listColumn(page, targetListTitle).locator('.card-drop');

  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Card or target list is not visible');

  // Armed before the drop and awaited after it: reloading before the PATCH lands aborts the save.
  const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/cards/'));
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(
      from.x + ((to.x + to.width / 2 - from.x) * step) / 8,
      from.y + ((to.y + 24 - from.y) * step) / 8,
    );
  }
  await page.mouse.up();
  await saved;
}

/** Opens the board's invite link and joins as a second, freshly registered user. */
export async function inviteSecondUser(owner: Page, browser: Browser, email: string) {
  await owner.getByRole('button', { name: 'Compartir' }).click();
  await owner.getByRole('button', { name: 'Crear enlace de invitación' }).click();
  const link = await owner.getByLabel('Enlace de invitación').inputValue();
  await owner.getByRole('button', { name: 'Cerrar' }).click();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await register(guest, email, 'Guest Driver');
  await guest.goto(new URL(link).pathname);
  await guest.getByRole('button', { name: /unirse/i }).click();
  await expect(guest).toHaveURL(/\/boards\/[^/?]+/);
  return { guest, guestContext };
}
