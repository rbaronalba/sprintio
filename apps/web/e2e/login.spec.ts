import { expect, test } from '@playwright/test';

const password = 'password123';

function uniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@sprintio.test`;
}

test('a registered user can log in and reach the dashboard', async ({ page }) => {
  const email = uniqueEmail();

  await page.goto('/register');
  await page.getByLabel('Nombre').fill('Test');
  await page.getByLabel('Apellido').fill('Driver');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();

  await expect(page).toHaveURL(/\/home$/);

  // Log out so the login form itself is exercised, not just the signup redirect.
  await page.getByRole('button', { name: 'Cuenta' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId('current-user')).toHaveText('Test Driver');
});

test('the session survives a page reload via the refresh cookie', async ({ page }) => {
  const email = uniqueEmail();

  await page.goto('/register');
  await page.getByLabel('Nombre').fill('Test');
  await page.getByLabel('Apellido').fill('Driver');
  await page.getByLabel('Correo electrónico').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page).toHaveURL(/\/home$/);

  // The access token only lives in memory, so this proves the refresh cookie works.
  await page.reload();

  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByTestId('current-user')).toHaveText('Test Driver');
});

test('logging in with a wrong password shows an error and stays on the login page', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(uniqueEmail());
  await page.getByLabel('Contraseña').fill('wrong-password');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos');
  await expect(page).toHaveURL(/\/login$/);
});

test('the dashboard is not reachable without a session', async ({ page }) => {
  await page.goto('/home');
  // The guard keeps returnUrl on the query string so the login lands you back here.
  await expect(page).toHaveURL(/\/login\?returnUrl=%2Fhome$/);
});
