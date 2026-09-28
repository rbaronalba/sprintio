import { expect, test } from '@playwright/test';
import { register, uniqueEmail } from './helpers';

test('a workspace invite link gives access to every board in it', async ({ page, browser }) => {
  await register(page, uniqueEmail('ws-owner'));

  // Create the workspace and a board in it from the Boards page.
  await page.getByRole('link', { name: 'Boards' }).click();
  await page.getByRole('button', { name: 'Create workspace' }).click();
  await page.getByLabel('Workspace name').fill('Software');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const software = page.getByRole('region', { name: 'Software' });
  await software.getByRole('button', { name: '+ Create new board' }).click();
  await software.getByLabel('Board title').fill('Backend');
  await software.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(software.getByRole('link', { name: 'Backend' })).toBeVisible();

  await software.getByRole('button', { name: 'Members' }).click();
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const link = await page.getByLabel('Workspace invitation link').inputValue();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await register(guest, uniqueEmail('ws-guest'), 'Guest Driver');
  await guest.goto(new URL(link).pathname);
  await guest.getByRole('button', { name: 'Join workspace' }).click();
  await expect(guest).toHaveURL(/\/w\//);

  await guest.getByRole('link', { name: 'Backend' }).click();
  await expect(guest).toHaveURL(/\/boards\/[^/]+$/);
  await guestContext.close();
});
