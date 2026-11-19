/** Ids of a list of entities, in order, so specs can assert order without mapping inline. */
export const idsOf = (items: { id: string }[]) => items.map((i) => i.id);
