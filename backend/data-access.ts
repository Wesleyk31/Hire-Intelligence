import { db } from '@appdeploy/sdk';

export type BoundedList<T> = {
  items: Array<T & { id: string }>;
  truncated: boolean;
  pagesRead: number;
};

export async function listBounded<T>(
  table: string,
  options?: { pageSize?: number; maxItems?: number },
): Promise<BoundedList<T>> {
  const pageSize = Math.max(1, Math.min(500, options?.pageSize || 250));
  const maxItems = Math.max(
    pageSize,
    Math.min(2500, options?.maxItems || 1000),
  );
  const items: Array<T & { id: string }> = [];
  let nextToken: string | undefined;
  let pagesRead = 0;
  do {
    const page = await db.list<T>(table, {
      limit: Math.min(pageSize, maxItems - items.length),
      nextToken,
    });
    items.push(...(page.items as Array<T & { id: string }>));
    pagesRead += 1;
    nextToken = page.nextToken;
  } while (nextToken && items.length < maxItems && pagesRead < 10);
  return { items, truncated: Boolean(nextToken), pagesRead };
}
