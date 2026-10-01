import { Browser, Page, expect, test } from '@playwright/test';
import { addCard, addList, createBoard, dragCardTo, listColumn, register, uniqueEmail } from './helpers';

/** Opens the board's invite link and joins as a second, freshly registered user. */
async function inviteSecondUser(owner: Page, browser: Browser, email: string) {
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

test.describe('live collaboration', () => {
  test('a card moved by one member appears moved for the other without a reload', async ({
    page: owner,
    browser,
  }) => {
    await register(owner, uniqueEmail('owner'));
    await createBoard(owner, 'Silverstone');
    await addList(owner, 'Pit wall');
    await addList(owner, 'Track');
    await addCard(owner, 'Pit wall', 'Radio check');

    const { guest, guestContext } = await inviteSecondUser(owner, browser, uniqueEmail('guest'));
    await expect(listColumn(guest, 'Pit wall').getByText('Radio check')).toBeVisible();

    await dragCardTo(owner, 'Radio check', 'Track');

    // No reload on the guest page: this only passes if the SSE stream delivered it.
    await expect(listColumn(guest, 'Track').getByText('Radio check')).toBeVisible({ timeout: 10_000 });
    await expect(listColumn(guest, 'Pit wall').getByText('Radio check')).toHaveCount(0);

    await guestContext.close();
  });

  test('assigning someone notifies them, and the notification opens the card', async ({
    page: owner,
    browser,
  }) => {
    const guestEmail = uniqueEmail('assignee');
    await register(owner, uniqueEmail('assigner'));
    await createBoard(owner, 'Suzuka');
    await addList(owner, 'Setup');
    await addCard(owner, 'Setup', 'Fit the wet tyres');

    const { guest, guestContext } = await inviteSecondUser(owner, browser, guestEmail);

    await owner.reload(); // pick up the new member in the assignee popover
    await listColumn(owner, 'Setup')
      .locator('.card')
      .filter({ hasText: 'Fit the wet tyres' })
      .getByRole('button', { name: /miembros/i })
      .click();
    await owner.getByRole('button', { name: /Guest Driver/ }).click();

    const bell = guest.getByRole('button', { name: /actividad/i });
    await expect(bell).toContainText('(1)', { timeout: 10_000 });

    await bell.click();
    await guest.getByText(/te asignó a Fit the wet tyres/i).click();
    // Following the notification lands on the board with that card's modal already open.
    await expect(guest.locator('.card-title-display')).toHaveText('Fit the wet tyres');

    await guestContext.close();
  });

  test('a mention in a comment notifies the mentioned member', async ({ page: owner, browser }) => {
    const guestEmail = uniqueEmail('mentioned');
    await register(owner, uniqueEmail('mentioner'));
    await createBoard(owner, 'Monaco');
    await addList(owner, 'Strategy');
    await addCard(owner, 'Strategy', 'Undercut on lap 20');

    const { guest, guestContext } = await inviteSecondUser(owner, browser, guestEmail);

    await listColumn(owner, 'Strategy').getByText('Undercut on lap 20').click();
    await owner.getByText('Escribe tu comentario aquí').click();
    await owner.locator('.new-comment [contenteditable]').fill(`@${guestEmail} thoughts?`);
    await owner.getByRole('button', { name: 'Comentar' }).click();

    await expect(guest.getByRole('button', { name: /actividad/i })).toContainText('(1)', {
      timeout: 10_000,
    });

    await guestContext.close();
  });

  test('reordering within one list reaches the other member', async ({ page: owner, browser }) => {
    await register(owner, uniqueEmail('reorder'));
    await createBoard(owner, 'Suzuka');
    await addList(owner, 'Grid');
    await addCard(owner, 'Grid', 'First');
    await addCard(owner, 'Grid', 'Second');
    const { guest, guestContext } = await inviteSecondUser(owner, browser, uniqueEmail('reorder-guest'));
    await expect(listColumn(guest, 'Grid').locator('.card').first()).toContainText('First');

    await dragCardTo(owner, 'Second', 'Grid');
    await expect(listColumn(owner, 'Grid').locator('.card').first()).toContainText('Second');
    await expect(listColumn(guest, 'Grid').locator('.card').first()).toContainText('Second', { timeout: 10_000 });

    await guestContext.close();
  });

  test("a user's other tab picks up their own changes", async ({ page: tab1, context }) => {
    await register(tab1, uniqueEmail('two-tabs'));
    await createBoard(tab1, 'Spa');
    await addList(tab1, 'Sector 1');
    const tab2 = await context.newPage();
    await tab2.goto(tab1.url());
    await expect(tab2.getByRole('heading', { name: 'Sector 1' })).toBeVisible();

    await addCard(tab1, 'Sector 1', 'Eau Rouge');
    await expect(listColumn(tab2, 'Sector 1').getByText('Eau Rouge')).toBeVisible({ timeout: 10_000 });
  });
});
