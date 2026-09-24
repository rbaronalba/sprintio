import { Page, expect } from '@playwright/test';

/**
 * Every run registers its own account, so tests never depend on data a previous run
 * left behind. Clean up with:
 *   DELETE FROM "User" WHERE email LIKE 'e2e-%@sprintio.test';
 */
export function uniqueEmail(tag: string): string {
  return `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@sprintio.test`;
}

export const PASSWORD = 'e2e-password-123';

export async function register(page: Page, email: string): Promise<void> {
  await page.goto('/register');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

export async function login(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Creates a board from the dashboard and opens it. Returns its id from the URL. */
export async function createBoard(page: Page, title: string): Promise<string> {
  await page.getByRole('button', { name: '+ Create new board' }).click();
  await page.getByLabel('Board title').fill(title);
  await page.getByRole('button', { name: 'Create', exact: true }).click();

  const link = page.getByRole('link', { name: title });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/boards\/[^/]+$/);
  return new URL(page.url()).pathname.split('/').pop()!;
}

export async function addList(page: Page, title: string): Promise<void> {
  // Trello-style, the composer stays open after adding so you can keep going, which
  // means the trigger button is only on screen for the first list.
  const trigger = page.getByRole('button', { name: '+ Add another list' });
  if (await trigger.isVisible()) await trigger.click();
  await page.getByPlaceholder('Enter list title').fill(title);
  await page.getByRole('button', { name: 'Add list' }).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
}

export function listColumn(page: Page, title: string) {
  return page.locator('.list-col').filter({ has: page.getByRole('heading', { name: title }) });
}

export async function addCard(page: Page, listTitle: string, cardTitle: string): Promise<void> {
  const column = listColumn(page, listTitle);
  const trigger = column.getByRole('button', { name: '+ Add a card' });
  if (await trigger.isVisible()) await trigger.click();
  await column.getByPlaceholder('Enter a title for this card').fill(cardTitle);
  await column.getByRole('button', { name: 'Add card' }).click();
  await expect(column.getByText(cardTitle, { exact: true })).toBeVisible();
}

/**
 * CDK drag-drop ignores a single instant mouse move, so the pointer is stepped across
 * the target to produce the intermediate move events it listens for.
 */
export async function dragCardTo(page: Page, cardTitle: string, targetListTitle: string) {
  const card = page.locator('.card').filter({ hasText: cardTitle }).first();
  const target = listColumn(page, targetListTitle).locator('.card-drop');

  const from = await card.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('Card or target list is not visible');

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 8; step++) {
    await page.mouse.move(
      from.x + ((to.x + to.width / 2 - from.x) * step) / 8,
      from.y + ((to.y + 24 - from.y) * step) / 8,
    );
  }
  await page.mouse.up();
}
