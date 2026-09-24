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

  test('moves a card to another list and keeps it there after a reload', async ({ page }) => {
    await register(page, uniqueEmail('drag'));
    await createBoard(page, 'Spa');
    await addList(page, 'Todo');
    await addList(page, 'Done');
    await addCard(page, 'Todo', 'Box this lap');

    await dragCardTo(page, 'Box this lap', 'Done');
    await expect(listColumn(page, 'Done').getByText('Box this lap')).toBeVisible();

    // The real assertion: the move was persisted, not just reordered in the DOM.
    await page.reload();
    await expect(listColumn(page, 'Done').getByText('Box this lap')).toBeVisible();
    await expect(listColumn(page, 'Todo').getByText('Box this lap')).toHaveCount(0);
  });

  test('signs back in and still sees the board', async ({ page }) => {
    const email = uniqueEmail('session');
    await register(page, email);
    await createBoard(page, 'Imola');

    // Log out lives on the dashboard, and createBoard leaves us inside the board.
    await page.getByRole('link', { name: '← Boards' }).click();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login/);

    await login(page, email);
    await expect(page.getByRole('link', { name: 'Imola' })).toBeVisible();
  });
});
