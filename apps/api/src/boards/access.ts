// Board access is membership-based: the owner is a member too (backfilled by the add_members migration).
export const memberOf = (userId: string) => ({ members: { some: { userId } } });

/**
 * One cap for both: workspace members are made members of every board in it, so a
 * lower board cap would be bypassed by any workspace larger than it.
 */
export const MAX_MEMBERS_PER_BOARD = 50;
