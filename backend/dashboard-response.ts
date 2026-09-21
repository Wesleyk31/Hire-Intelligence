import { error, json, type RouterResponse } from '@appdeploy/sdk';

// Leave room below the hosting runtime's 6 MiB response envelope limit, including
// JSON escaping. Re-read from the SAME cursor; only the returned window advances.
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
export async function boundedDashboardResponse(
  build: (windowRecords: number) => Promise<unknown>,
): Promise<RouterResponse> {
  for (const windowRecords of [250, 100, 25, 1]) {
    const response = json(await build(windowRecords));
    if (
      Buffer.byteLength(JSON.stringify(response), 'utf8') <= MAX_RESPONSE_BYTES
    )
      return response;
  }
  return error(
    'This evidence record is too large to display. Please review it in Source Admin.',
    503,
  );
}
