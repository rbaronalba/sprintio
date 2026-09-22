// Board access is membership-based: the owner is a member too (backfilled by the add_members migration).
export const memberOf = (userId: string) => ({ members: { some: { userId } } });
