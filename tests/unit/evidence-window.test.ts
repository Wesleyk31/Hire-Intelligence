import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  listOverride: undefined as undefined | ((table: string, options: any) => any),
  list: vi.fn(),
  get: vi.fn(),
  add: vi.fn(),
  update: vi.fn(),
}));
vi.mock('@appdeploy/sdk', () => ({
  db: {
    list: (...args: any[]) => store.list(...args),
    get: (...args: any[]) => store.get(...args),
    add: (...args: any[]) => store.add(...args),
    update: (...args: any[]) => store.update(...args),
  },
}));
import { loadEvidenceUniverse } from '../../backend/evidence-store';
import { evidenceTimestamp } from '../../backend/domain-hardening';
const evidence = (number: number, extra: Record<string, unknown> = {}) => ({
  sourceKey: 'qa-source',
  externalId: 'record-' + number,
  project: 'Synthetic project ' + number,
  location: 'Perth WA',
  company: '',
  description: 'QA bounded-window fixture',
  value: 'Not stated',
  observedAt: '2026-09-16T00:00:00Z',
  sourceObservedAt: '2020-01-01',
  provenance: 'https://example.test/evidence/' + number,
  ...extra,
});
const live = (number: number, extra = {}) => ({
  id: 'live-' + number,
  ...evidence(number, extra),
});
const page = (id: string, start: number, count: number) => ({
  id,
  sourceKey: 'qa-source',
  events: Array.from({ length: count }, (_, index) => evidence(start + index)),
});
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');
const load = (cursor?: string) => loadEvidenceUniverse(cursor);
beforeEach(() => {
  store.tables = {};
  store.listOverride = undefined;
  store.list
    .mockReset()
    .mockImplementation(async (table: string, options: any = {}) => {
      if (store.listOverride)
        return structuredClone(store.listOverride(table, options));
      const all = store.tables[table] || [],
        start = Number(options.nextToken || 0),
        end = start + options.limit;
      return {
        items: structuredClone(all.slice(start, end)),
        nextToken: end < all.length ? String(end) : undefined,
      };
    });
  // Official db.get returns record data in request order without attaching IDs.
  store.get
    .mockReset()
    .mockImplementation(async (table: string, ids: string[]) =>
      ids.map((id) => {
        const row = (store.tables[table] || []).find((item) => item.id === id);
        if (!row) return null;
        const { id: _id, ...record } = structuredClone(row);
        return record;
      }),
    );
  store.add.mockReset();
  store.update.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-16T00:00:00Z'));
});
afterEach(() => {
  expect(store.add).not.toHaveBeenCalled();
  expect(store.update).not.toHaveBeenCalled();
  vi.useRealTimers();
});

describe('operational evidence continuation', () => {
  it('uses smaller live and archive budgets while resuming every record across changing window sizes', async () => {
    store.tables.opportunities = Array.from({ length: 9 }, (_, index) =>
      live(index),
    );
    store.tables.evidence_pages = Array.from({ length: 7 }, (_, index) =>
      page('small-' + index, 100 + index * 3, 3),
    );
    let cursor: string | undefined;
    const observed: string[] = [];
    const sizes = [2, 1, 3];
    let complete = false;
    for (let index = 0; index < 30; index++) {
      const limit = sizes[index % sizes.length];
      const result = await loadEvidenceUniverse(cursor, limit);
      expect(result.coverage.liveLoaded).toBeLessThanOrEqual(limit);
      expect(result.coverage.archiveRecordsLoaded).toBeLessThanOrEqual(limit);
      observed.push(...result.items.map((row) => row.externalId));
      cursor = result.nextCursor;
      if (!cursor) {
        complete = true;
        break;
      }
    }
    expect(complete).toBe(true);
    const expected = [
      ...Array.from({ length: 9 }, (_, index) => 'record-' + index),
      ...Array.from({ length: 21 }, (_, index) => 'record-' + (100 + index)),
    ];
    expect(observed.sort()).toEqual(expected.sort());
    expect(new Set(observed).size).toBe(30);
    expect(
      store.list.mock.calls
        .filter(([table]) => table === 'evidence_pages')
        .map(([, options]) => options.nextToken),
    ).toEqual([undefined, '5']);
    expect(store.get).toHaveBeenCalledWith('evidence_pages', [
      'small-0',
      'small-1',
      'small-2',
      'small-3',
      'small-4',
    ]);
  });

  it('counts invalid archive events against a smaller budget without skipping the next valid event', async () => {
    store.tables.evidence_pages = [
      {
        id: 'invalid-small',
        sourceKey: 'qa-source',
        events: [null, evidence(1), evidence(2)],
      },
    ];
    const first = await loadEvidenceUniverse(undefined, 1);
    expect(first.items).toEqual([]);
    expect(first.coverage).toMatchObject({
      archiveRecordsLoaded: 1,
      invalidArchiveRecords: 1,
    });
    const second = await loadEvidenceUniverse(first.nextCursor, 2);
    expect(second.items.map((row) => row.externalId)).toEqual([
      'record-1',
      'record-2',
    ]);
    expect(second.nextCursor).toBeUndefined();
  });

  it.each([0, -1, 1.5, 1501, NaN, Infinity, Number.MAX_SAFE_INTEGER])(
    'rejects an invalid record limit %s before reading storage',
    async (limit) => {
      await expect(loadEvidenceUniverse(undefined, limit)).rejects.toThrow(
        'INVALID_EVIDENCE_WINDOW_LIMIT',
      );
      expect(store.list).not.toHaveBeenCalled();
      expect(store.get).not.toHaveBeenCalled();
    },
  );

  it('traverses more than 3000 current records without restarting current pagination', async () => {
    store.tables.opportunities = Array.from({ length: 3205 }, (_, index) =>
      live(index),
    );
    const first = await load(),
      second = await load(first.nextCursor),
      third = await load(second.nextCursor);
    expect([
      first.items.length,
      second.items.length,
      third.items.length,
    ]).toEqual([1500, 1500, 205]);
    expect(
      new Set(
        [...first.items, ...second.items, ...third.items].map(
          (row) => row.externalId,
        ),
      ).size,
    ).toBe(3205);
    expect(first.nextCursor).toBeTruthy();
    expect(second.nextCursor).toBeTruthy();
    expect(third.nextCursor).toBeUndefined();
    expect(
      store.list.mock.calls
        .filter(([table]) => table === 'opportunities')
        .map(([, options]) => options.nextToken),
    ).toEqual([undefined, '500', '1000', '1500', '2000', '2500', '3000']);
    expect(
      store.list.mock.calls.filter(([table]) => table === 'evidence_pages'),
    ).toHaveLength(1);
  });

  it('resumes a legacy page and every unconsumed fetched page by saved ID', async () => {
    store.tables.evidence_pages = [
      page('long', 0, 1705),
      page('second', 1705, 400),
      page('third', 2105, 500),
      page('last', 2605, 3),
    ];
    const first = await load();
    expect(first.coverage).toMatchObject({
      archiveRecordsLoaded: 1500,
      archivePagesRead: 1,
      archiveTruncated: true,
    });
    const second = await load(first.nextCursor);
    expect(second.items).toHaveLength(1108);
    expect(
      new Set([...first.items, ...second.items].map((row) => row.externalId))
        .size,
    ).toBe(2608);
    expect(store.get).toHaveBeenCalledWith('evidence_pages', [
      'long',
      'second',
      'third',
      'last',
    ]);
    expect(
      store.list.mock.calls.filter(([table]) => table === 'evidence_pages'),
    ).toHaveLength(1);
    expect(
      store.list.mock.calls.filter(([table]) => table === 'opportunities'),
    ).toHaveLength(1);
    expect(second.nextCursor).toBeUndefined();
  });

  it('preserves extra fetched pages before advancing the archive list token', async () => {
    const sizes = [800, 800, 200, 200, 200, 200, 20];
    let offset = 0;
    store.tables.evidence_pages = sizes.map((size, index) => {
      const result = page('page-' + index, offset, size);
      offset += size;
      return result;
    });
    const first = await load(),
      second = await load(first.nextCursor);
    expect(first.items).toHaveLength(1500);
    expect(second.items).toHaveLength(920);
    expect(
      new Set([...first.items, ...second.items].map((row) => row.externalId))
        .size,
    ).toBe(2420);
    expect(store.get).toHaveBeenCalledWith('evidence_pages', [
      'page-1',
      'page-2',
      'page-3',
      'page-4',
    ]);
    expect(
      store.list.mock.calls
        .filter(([table]) => table === 'evidence_pages')
        .map(([, options]) => options.nextToken),
    ).toEqual([undefined, '5']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('finishes exactly at the archive event limit without a false continuation', async () => {
    store.tables.evidence_pages = [page('exact', 0, 1500)];
    const result = await load();
    expect(result.items).toHaveLength(1500);
    expect(result.nextCursor).toBeUndefined();
    expect(result.coverage).toMatchObject({
      archiveTruncated: false,
      truncated: false,
    });
  });

  it('does not reread a completed archive while current records continue', async () => {
    store.tables.opportunities = Array.from({ length: 1700 }, (_, index) =>
      live(index),
    );
    store.tables.evidence_pages = [page('finished', 9000, 5)];
    const first = await load(),
      second = await load(first.nextCursor);
    expect(second.items).toHaveLength(200);
    expect(second.coverage).toMatchObject({
      archiveRecordsLoaded: 0,
      archivePagesRead: 0,
    });
    expect(
      store.list.mock.calls.filter(([table]) => table === 'evidence_pages'),
    ).toHaveLength(1);
    expect(store.get).not.toHaveBeenCalled();
  });

  it('continues beyond 20 blank or malformed stored pages without dropping later evidence', async () => {
    store.tables.evidence_pages = Array.from({ length: 22 }, (_, index) => ({
      id: 'page-' + index,
      sourceKey: 'qa-source',
      events: index === 21 ? [evidence(999)] : index % 2 ? [] : null,
    }));
    const first = await load(),
      second = await load(first.nextCursor);
    expect(first.coverage).toMatchObject({
      archivePagesRead: 20,
      invalidArchivePages: 10,
      archiveRecordsLoaded: 0,
      truncated: true,
    });
    expect(second.coverage).toMatchObject({
      archivePagesRead: 2,
      invalidArchivePages: 1,
    });
    expect(second.items.map((row) => row.externalId)).toEqual(['record-999']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('caps empty database-page traversal at ten calls and continues from its token', async () => {
    store.listOverride = (table, options) => {
      if (table === 'opportunities') return { items: [] };
      const at = Number(options.nextToken || 0);
      return at < 12
        ? { items: [], nextToken: String(at + 1) }
        : { items: [page('late', 12, 1)] };
    };
    const first = await load();
    expect(first.coverage.pagesRead).toBe(11);
    expect(first.nextCursor).toBeTruthy();
    const second = await load(first.nextCursor);
    expect(second.items).toHaveLength(1);
    expect(second.coverage.pagesRead).toBe(3);
    expect(second.nextCursor).toBeUndefined();
  });

  it('counts malformed events toward the event budget and resumes at the next unconsumed event', async () => {
    store.tables.evidence_pages = [
      {
        id: 'invalid-first',
        sourceKey: 'qa-source',
        events: [...Array(1500).fill(null), evidence(1)],
      },
    ];
    const first = await load(),
      second = await load(first.nextCursor);
    expect(first.items).toHaveLength(0);
    expect(first.coverage).toMatchObject({
      archiveRecordsLoaded: 1500,
      invalidArchiveRecords: 1500,
    });
    expect(second.items.map((row) => row.externalId)).toEqual(['record-1']);
    expect(second.nextCursor).toBeUndefined();
  });

  it('fails visibly when a pending page is missing rather than restarting or skipping it', async () => {
    store.tables.evidence_pages = [
      page('first', 0, 1600),
      page('pending', 1600, 1),
    ];
    const first = await load();
    store.tables.evidence_pages.pop();
    store.list.mockClear();
    await expect(load(first.nextCursor)).rejects.toThrow(
      'EVIDENCE_WINDOW_CHANGED_RESTART',
    );
    expect(store.list).not.toHaveBeenCalled();
  });

  it('detects changed pending page content even when its event count is unchanged', async () => {
    store.tables.evidence_pages = [page('first', 0, 1600)];
    const first = await load();
    store.tables.evidence_pages[0].events[1550].project =
      'Changed after first window';
    await expect(load(first.nextCursor)).rejects.toThrow(
      'EVIDENCE_WINDOW_CHANGED_RESTART',
    );
  });

  it('detects repeated current tokens within a request and across windows', async () => {
    store.listOverride = (table, options) =>
      table === 'evidence_pages'
        ? { items: [] }
        : {
            items: [live(1)],
            nextToken: options.nextToken === 'alpha' ? 'beta' : 'alpha',
          };
    await expect(load()).rejects.toThrow('EVIDENCE_WINDOW_PAGINATION_STALLED');
    store.listOverride = undefined;
    store.tables.opportunities = Array.from({ length: 1600 }, (_, index) =>
      live(index),
    );
    const first = await load();
    store.listOverride = (table) =>
      table === 'opportunities'
        ? { items: [live(1500)], nextToken: '500' }
        : { items: [] };
    await expect(load(first.nextCursor)).rejects.toThrow(
      'EVIDENCE_WINDOW_PAGINATION_STALLED',
    );
  });

  it('detects a repeated archive token after resuming a pending page', async () => {
    store.listOverride = (table, options) =>
      table === 'opportunities'
        ? { items: [] }
        : options.nextToken
          ? { items: [], nextToken: 'same' }
          : { items: [page('long', 0, 1501)], nextToken: 'same' };
    store.tables.evidence_pages = [page('long', 0, 1501)];
    const first = await load();
    await expect(load(first.nextCursor)).rejects.toThrow(
      'EVIDENCE_WINDOW_PAGINATION_STALLED',
    );
  });

  it('rejects malformed, oversized, mismatched and inconsistent cursors before any database call', async () => {
    store.tables.opportunities = Array.from({ length: 1501 }, (_, index) =>
      live(index),
    );
    const first = await load(),
      valid = JSON.parse(
        Buffer.from(first.nextCursor!, 'base64url').toString('utf8'),
      );
    const invalid = [
      '',
      'not-json',
      'bad!!',
      'x'.repeat(12001),
      encode({ ...valid, v: 2 }),
      encode({ ...valid, kind: 'review' }),
      encode({ ...valid, extra: true }),
      encode({ ...valid, live: { ...valid.live, done: true } }),
      encode({
        ...valid,
        archive: {
          ...valid.archive,
          pending: [{ id: 'id', offset: -1, fingerprint: 'a'.repeat(64) }],
        },
      }),
      encode({
        ...valid,
        archive: {
          ...valid.archive,
          pending: Array(6).fill({
            id: 'id',
            offset: 0,
            fingerprint: 'a'.repeat(64),
          }),
        },
      }),
      encode({ ...valid, live: { ...valid.live, token: 123 } }),
    ];
    store.list.mockClear();
    store.get.mockClear();
    for (const cursor of invalid)
      await expect(load(cursor)).rejects.toThrow(
        'INVALID_EVIDENCE_WINDOW_CURSOR',
      );
    expect(store.list).not.toHaveBeenCalled();
    expect(store.get).not.toHaveBeenCalled();
  });

  it('keeps default source dates, preferred revisions and within-window deduplication unchanged', async () => {
    store.tables.opportunities = [
      live(1, {
        project: 'Newer live project',
        sourceObservedAt: '2026-09-15',
      }),
    ];
    store.tables.evidence_pages = [
      page('old', 1, 1),
      {
        id: 'revisions',
        sourceKey: 'qa-source',
        events: [
          evidence(1),
          evidence(2, {
            project: 'Newer archive project',
            sourceObservedAt: '2025-01-01',
          }),
          evidence(2, {
            project: 'Older archive project',
            sourceObservedAt: '2020-01-01',
          }),
          evidence(3, { sourceObservedAt: undefined }),
        ],
      },
    ];
    const original = structuredClone(store.tables);
    const result = await load();
    expect(result.items).toHaveLength(3);
    expect(
      result.items.find((row) => row.externalId === 'record-1'),
    ).toMatchObject({ evidenceOrigin: 'LIVE', project: 'Newer live project' });
    expect(
      result.items.find((row) => row.externalId === 'record-2'),
    ).toMatchObject({
      evidenceOrigin: 'ARCHIVE',
      project: 'Newer archive project',
    });
    expect(
      evidenceTimestamp(
        result.items.find((row) => row.externalId === 'record-3')!,
      ),
    ).toBe(0);
    expect(result.coverage.duplicateRecords).toBe(3);
    expect(store.tables).toEqual(original);
  });

  it('discloses per-window counts and permits the same identity in a later window', async () => {
    store.tables.opportunities = [
      ...Array.from({ length: 1500 }, (_, index) => live(index)),
      live(0, { id: 'later-revision', project: 'Later revision' }),
    ];
    const first = await load(),
      second = await load(first.nextCursor);
    expect(first.items.some((row) => row.externalId === 'record-0')).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.items[0].project).toBe('Later revision');
    expect(second.coverage).toMatchObject({
      windowOnly: true,
      snapshot: false,
      deduplicationScope: 'WINDOW',
      duplicateRecords: 0,
    });
    expect(second.coverage.disclosure).toMatch(/window/i);
    expect(second.coverage.disclosure).toMatch(/concurrent/i);
  });
});

it('preserves archive quality flags and explicit context/promotion restrictions', async () => {
  store.tables.evidence_pages = [
    {
      id: 'restricted',
      sourceKey: 'qa-source',
      events: [
        evidence(1, {
          qualityFlags: ['NATURAL_ID_REVIEW_REQUIRED', 'UNDATED_CONTEXT'],
          contextOnly: true,
          promotionEligible: false,
        }),
        evidence(2, {
          qualityFlags: ['VALIDATED'],
          contextOnly: false,
          promotionEligible: true,
        }),
      ],
    },
  ];
  const result = await load();
  expect(
    result.items.find((row) => row.externalId === 'record-1'),
  ).toMatchObject({
    qualityFlags: ['NATURAL_ID_REVIEW_REQUIRED', 'UNDATED_CONTEXT'],
    contextOnly: true,
    promotionEligible: false,
  });
  expect(
    result.items.find((row) => row.externalId === 'record-2'),
  ).toMatchObject({
    qualityFlags: ['VALIDATED'],
    contextOnly: false,
    promotionEligible: true,
  });
});

it('retains malformed archive restrictions as holds instead of erasing them', async () => {
  store.tables.evidence_pages = [
    {
      id: 'malformed-holds',
      sourceKey: 'qa-source',
      events: [
        evidence(1, { qualityFlags: 'INVALID_INPUT' }),
        evidence(2, { qualityFlags: [42] }),
        evidence(3, { contextOnly: 'true' }),
        evidence(4, { promotionEligible: null }),
      ],
    },
  ];
  const result = await load();
  expect(result.items).toHaveLength(4);
  for (const row of result.items)
    expect(row.qualityFlags?.length).toBeGreaterThan(0);
});

it('does not clear a held revision when a preferred live duplicate lacks its restriction', async () => {
  store.tables.opportunities = [
    live(1, {
      sourceObservedAt: '2026-09-01',
      description: 'New current description',
    }),
  ];
  store.tables.evidence_pages = [
    {
      id: 'held-version',
      sourceKey: 'qa-source',
      events: [
        evidence(1, {
          sourceObservedAt: '2020-01-01',
          qualityFlags: ['INVALID_INPUT'],
          contextOnly: true,
        }),
      ],
    },
  ];
  const before = JSON.stringify(store.tables),
    result = await load();
  expect(result.items).toHaveLength(1);
  expect(result.items[0].description).toBe('New current description');
  expect(result.items[0].qualityFlags).toEqual(
    expect.arrayContaining(['INVALID_INPUT', 'CONTEXT_ONLY']),
  );
  expect(JSON.stringify(store.tables)).toBe(before);
});
