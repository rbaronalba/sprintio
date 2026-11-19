import { expect, test } from '@playwright/test';
import { PASSWORD, login, register, uniqueEmail } from './helpers';

test('a registered user can log in and reach the dashboard', async ({
  page,
}) => {
  const email = uniqueEmail('login');
  await register(page, email);

  // Log out so the login form itself is exercised, not just the signup redirect.
  await page.getByRole('button', { name: 'Cuenta' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await login(page, email);

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId('current-user')).toHaveText('Test Driver');
});

test('the session survives a page reload via the refresh cookie', async ({
  page,
}) => {
  await register(page, uniqueEmail('reload'));

  // The access token only lives in memory, so this proves the refresh cookie works.
  await page.reload();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId('current-user')).toHaveText('Test Driver');
});

test('logging in with a wrong password shows an error and stays on the login page', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(uniqueEmail('wrong'));
  await page.getByLabel('Contraseña').fill(`wrong-${PASSWORD}`);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByRole('alert')).toHaveText(
    'Correo o contraseña incorrectos',
  );
  await expect(page).toHaveURL(/\/login$/);
});

test('the dashboard is not reachable without a session', async ({ page }) => {
  await page.goto('/home');
  // The guard keeps returnUrl on the query string so the login lands you back here.
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fhome$/);
});
