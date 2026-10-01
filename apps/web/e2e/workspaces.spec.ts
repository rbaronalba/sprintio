import { expect, test } from '@playwright/test';
import { register, uniqueEmail } from './helpers';

test('a workspace invite link gives access to every board in it', async ({ page, browser }) => {
  await register(page, uniqueEmail('ws-owner'));

  // Create the workspace and a board in it from the Boards page.
  await page.getByRole('link', { name: 'Tableros' }).click();
  await page.getByRole('button', { name: 'Crear espacio de trabajo' }).click();
  await page.getByLabel('Nombre del espacio de trabajo').fill('Software');
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  const software = page.getByRole('region', { name: 'Software' });
  await software.getByRole('button', { name: '+ Nuevo tablero' }).click();
  await software.getByLabel('Título del tablero').fill('Backend');
  await software.getByRole('button', { name: 'Crear', exact: true }).click();
  await expect(software.getByRole('link', { name: 'Backend' })).toBeVisible();

  await software.getByRole('button', { name: 'Miembros' }).click();
  await page.getByRole('button', { name: 'Crear enlace de invitación' }).click();
  const link = await page.getByLabel('Enlace de invitación al espacio de trabajo').inputValue();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await register(guest, uniqueEmail('ws-guest'), 'Guest Driver');
  await guest.goto(new URL(link).pathname);
  await guest.getByRole('button', { name: 'Unirse al espacio de trabajo' }).click();
  await expect(guest).toHaveURL(/\/w\//);

  await guest.getByRole('link', { name: 'Backend' }).click();
  await expect(guest).toHaveURL(/\/boards\/[^/]+$/);
  await guestContext.close();
});
