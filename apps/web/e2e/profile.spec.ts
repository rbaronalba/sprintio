import { expect, test } from '@playwright/test';
import { PASSWORD, register, uniqueEmail } from './helpers';

test('changing the password from the profile: the old one stops working, the new one signs in', async ({ page }) => {
  const email = uniqueEmail('pw-change');
  await register(page, email);

  await page.getByRole('button', { name: 'Cuenta' }).click();
  await page.getByRole('button', { name: 'Perfil' }).click();
  await page.locator('dialog[open]').getByRole('link', { name: 'Cambiar contraseña' }).click();
  await expect(page).toHaveURL(/\/account\/password$/);
  const form = page.locator('main');

  // A wrong current password is refused without signing the user out.
  await form.getByLabel('Contraseña actual').fill('not-my-password');
  await form.getByLabel('Nueva contraseña', { exact: true }).fill('brand-new-pass-1');
  await form.getByLabel('Repite la nueva contraseña').fill('brand-new-pass-1');
  await form.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(form.getByRole('status')).toHaveText('La contraseña actual no es correcta');

  await form.getByLabel('Contraseña actual').fill(PASSWORD);
  await form.getByRole('button', { name: 'Cambiar contraseña' }).click();
  await expect(form.getByRole('status')).toContainText('Contraseña cambiada');

  await page.getByRole('button', { name: 'Cuenta' }).click();
  await page.getByRole('button', { name: 'Cerrar sesión' }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.locator('#email').fill(email);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /iniciar sesión/i }).click();
  await expect(page.getByRole('alert')).toContainText('Correo o contraseña incorrectos');

  await page.locator('#password').fill('brand-new-pass-1');
  await page.getByRole('button', { name: /iniciar sesión/i }).click();
  await expect(page).toHaveURL(/\/home/);
});

test('the login page hides Microsoft sign-in when the server is not configured for it', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Iniciar sesión' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Iniciar sesión con Microsoft' })).toHaveCount(0);
});
