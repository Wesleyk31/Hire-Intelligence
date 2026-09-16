import { db } from '@appdeploy/sdk';
type RefreshControl = {
  nextIndex: number;
  cycles: number;
  lastRun: string;
  sourceKeys: string[];
};
/** A scheduled invocation handles at most three sources. No in-process retry or full-table scan. */
export async function runRefreshSlice<S extends { key: string }, R>(
  sources: readonly S[],
  run: (source: S) => Promise<R>,
  batchSize = 3,
) {
  if (!sources.length)
    return { states: [] as R[], nextIndex: 0, cycleWrapped: false };
  if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 6)
    throw new Error('INVALID_REFRESH_BATCH_SIZE');
  const page = await db.list<RefreshControl>('refresh_control', { limit: 1 });
  const control = page.items[0];
  const start =
    control && Number.isSafeInteger(control.nextIndex) && control.nextIndex >= 0
      ? control.nextIndex % sources.length
      : 0;
  const selected = sources.slice(start, start + batchSize);
  const results = await Promise.allSettled(selected.map(run));
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  const states = results.map(
    (result) => (result as PromiseFulfilledResult<R>).value,
  );
  const nextIndex = (start + selected.length) % sources.length,
    cycleWrapped = nextIndex === 0;
  const record: RefreshControl = {
    nextIndex,
    cycles: (control?.cycles || 0) + Number(cycleWrapped),
    lastRun: new Date().toISOString(),
    sourceKeys: selected.map((source) => source.key),
  };
  const [saved] = control
    ? await db.update('refresh_control', [
        { id: control.id, record: { ...record } },
      ])
    : await db.add('refresh_control', [{ ...record }]);
  if (!saved) throw new Error('REFRESH_CHECKPOINT_SAVE_FAILED');
  return { states, nextIndex, cycleWrapped };
}
