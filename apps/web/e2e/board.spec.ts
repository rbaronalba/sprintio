import { expect, test } from '@playwright/test';
import { addCard, addList, createBoard, dragCardTo, listColumn, login, register, uniqueEmail } from './helpers';

test.describe('board basics', () => {
  test('registers, creates a board, and adds a list and a card', async ({ page }) => {
    await register(page, uniqueEmail('basics'));
    await createBoard(page, 'Monza');
    await addList(page, 'Backlog');
    await addCard(page, 'Backlog', 'Change the tyres');

    await expect(listColumn(page, 'Backlog').getByText('Change the tyres')).toBeVisible();
  });

  // Regression: the popovers used to sit outside the modal <dialog>, which showModal()
  // makes inert — they rendered but swallowed every click.
  test('assigns a member, creates a label, logs time and attaches a file from the card modal', async ({ page }) => {
    await register(page, uniqueEmail('modal-pops'));
    await createBoard(page, 'Imola');
    await addList(page, 'Todo');
    await addCard(page, 'Todo', 'Check brake ducts');

    await listColumn(page, 'Todo').getByText('Check brake ducts').click();
    const modal = page.locator('dialog[open]');

    await modal.getByRole('button', { name: 'Add members' }).click();
    await modal.getByRole('button', { name: /Test Driver/ }).click();
    await expect(modal.locator('.meta-chips .avatar')).toHaveText('TD');

    await modal.getByRole('button', { name: 'Add labels' }).click();
    await modal.getByRole('button', { name: 'Create a new label' }).click();
    await modal.getByLabel('Title').fill('Aero');
    await modal.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(modal.locator('.meta-chips .label-chip')).toHaveText('Aero');

    // The modal's running total must follow a new entry without reopening the card.
    await modal.getByRole('button', { name: 'Add time' }).click();
    const timePop = modal.locator('.time-pop');
    await timePop.getByLabel('Time', { exact: true }).fill('2.5');
    await timePop.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(modal.locator('.time-summary')).toHaveText('Time: 2.5h');

    // Attach sits in the comments column: one click opens the file picker.
    await modal.locator('.card-dialog-side input[type=file]').setInputFiles({
      name: 'pit.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await expect(modal.locator('.card-dialog-side .attachment img')).toHaveAttribute('alt', 'pit.png');
  });

  test('moves a card to another list and keeps it there after a reload', async ({ page }) => {
    await register(page, uniqueEmail('drag'));
    await createBoard(page, 'Spa');
    await addList(page, 'Todo');
    await addList(page, 'Done');
    await addCard(page, 'Todo', 'Box this lap');

    // Reloading before the PATCH lands aborts it, which reads as "the move wasn't saved".
    const saved = page.waitForResponse((r) => r.request().method() === 'PATCH' && r.url().includes('/cards/'));
    await dragCardTo(page, 'Box this lap', 'Done');
    await expect(listColumn(page, 'Done').getByText('Box this lap')).toBeVisible();
    await saved;

    // The real assertion: the move was persisted, not just reordered in the DOM.
    await page.reload();
    await expect(listColumn(page, 'Done').getByText('Box this lap')).toBeVisible();
    await expect(listColumn(page, 'Todo').getByText('Box this lap')).toHaveCount(0);
  });

  test('signs back in and still sees the board', async ({ page }) => {
    const email = uniqueEmail('session');
    await register(page, email);
    await createBoard(page, 'Imola');

    // Log out lives in the account menu of the top bar.
    await page.getByRole('button', { name: 'Account' }).click();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login/);

    await login(page, email);
    await expect(page.getByRole('link', { name: 'Imola' })).toBeVisible();
  });
});
