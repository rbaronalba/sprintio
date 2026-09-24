import { Browser, Page, expect, test } from '@playwright/test';
import { addCard, addList, createBoard, dragCardTo, listColumn, register, uniqueEmail } from './helpers';

/** Opens the board's invite link and joins as a second, freshly registered user. */
async function inviteSecondUser(owner: Page, browser: Browser, email: string) {
  await owner.getByRole('button', { name: 'Share' }).click();
  await owner.getByRole('button', { name: 'Create invite link' }).click();
  const link = await owner.getByLabel('Invitation link').inputValue();
  await owner.getByRole('button', { name: 'Close' }).click();

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await register(guest, email);
  await guest.goto(new URL(link).pathname);
  await guest.getByRole('button', { name: /join/i }).click();
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
      .getByRole('button', { name: /member/i })
      .click();
    await owner.getByRole('button', { name: new RegExp(guestEmail, 'i') }).click();

    const bell = guest.getByRole('button', { name: /activity/i });
    await expect(bell).toContainText('(1)', { timeout: 10_000 });

    await bell.click();
    await guest.getByText(/assigned you to Fit the wet tyres/i).click();
    // Following the notification lands on the board with that card's modal already open.
    await expect(guest.locator('#card-title')).toHaveValue('Fit the wet tyres');

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
    await owner.getByPlaceholder(/write a comment/i).fill(`@${guestEmail} thoughts?`);
    await owner.getByRole('button', { name: 'Comment' }).click();

    await expect(guest.getByRole('button', { name: /activity/i })).toContainText('(1)', {
      timeout: 10_000,
    });

    await guestContext.close();
  });
});
