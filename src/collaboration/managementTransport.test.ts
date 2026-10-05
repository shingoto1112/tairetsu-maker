import { expect, it } from 'vitest';
import { createManagementTransport } from './managementTransport';
const config = { url: 'http://127.0.0.1:54321', anonKey: 'test' };
const id = '00000000-0000-0000-0000-000000000001';
const legacy = { inviteId: id, expiresAt: '2026-10-06T00:00:00Z', status: 'active' };
const load = (item: unknown) => createManagementTransport(config, async () => Response.json([item]))
  .invites(id, { accessToken: 'test', accountId: id }, new AbortController().signal);
it('accepts old servers and optional multi-use metadata', async () => {
  expect(await load(legacy)).toEqual([legacy]);
  const multi = { ...legacy, multiUse: true, joinedCount: 7 };
  expect(await load(multi)).toEqual([multi]);
  // Frozen build-23 validation: added fields are ignored; the four statuses remain valid.
  for (const status of ['active','used','expired','revoked']) {
    const v = { ...multi, status };
    expect(typeof v.expiresAt === 'string' && Number.isFinite(Date.parse(v.expiresAt)) &&
      ['active','used','expired','revoked'].includes(v.status)).toBe(true);
  }
});
it.each([{multiUse:1},{joinedCount:-1},{joinedCount:65},{joinedCount:1.5},{joinedCount:'1'},{joinedCount:null}])('rejects invalid metadata %j', async extra => {
  await expect(load({...legacy,...extra})).rejects.toMatchObject({ code:'INVALID_MANAGEMENT_RESPONSE' });
});
