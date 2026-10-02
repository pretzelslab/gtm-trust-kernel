# @gtm-trust-kernel/adapters

[![npm](https://img.shields.io/npm/v/@gtm-trust-kernel/adapters)](https://www.npmjs.com/package/@gtm-trust-kernel/adapters)
[![ci](https://github.com/pretzelslab/gtm-trust-kernel/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/pretzelslab/gtm-trust-kernel/actions/workflows/ci.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/pretzelslab/gtm-trust-kernel/blob/master/LICENSE)

**One interface for reading CRM data, with a contract test suite that
proves an adapter behaves the same as every other.**

This package is the CRM layer of the
[GTM trust kernel](https://github.com/pretzelslab/gtm-trust-kernel): the
`CrmAdapter` interface, a canonical record model (accounts, deals,
contacts, activities, notes, stage history), a trust envelope for
free-text fields, an in-memory mock CRM, a **read-only** Salesforce
adapter, and the shared contract suites every adapter must pass.

## Who it's for

- **Developers adding a CRM** (HubSpot, Dynamics, ...): implement
  `CrmAdapter`, then run the contract suite against it.
- **Developers testing CRM-reading code** without a real org: use the mock.
- **Anyone who just wants a CRM health report:** you don't need this
  package directly. Use the [`gtm-trust-kernel`](https://www.npmjs.com/package/gtm-trust-kernel) CLI.

## Install

```bash
npm install @gtm-trust-kernel/adapters
```

Node.js 22 or newer. **ESM only:** use `import`, not `require()`. From
CommonJS, use a dynamic `import()`.

## Quickstart (60 seconds, no CRM needed)

```js
// quickstart.mjs
import { makeMockAdapter } from '@gtm-trust-kernel/adapters/fixtures';

const adapter = makeMockAdapter();
const caps = adapter.capabilities();
console.log(`writes: ${caps.writeGranularity}, stage history: ${caps.stageHistory}`);

const page = await adapter.listOpportunities({ limit: 3 });
for (const o of page.items) console.log(o.ref.id, o.stage, o.name);
```

```text
$ node quickstart.mjs
writes: field, stage history: true
opp-1 negotiation Quillfeather — Platform expansion
opp-2 discovery Quillfeather — Pilot
```

Every adapter answers the same calls with the same canonical records, so
code written against the mock runs unchanged against Salesforce.

## Salesforce (read-only)

```js
import { SalesforceAdapter, loadSalesforceConfigFromEnv } from '@gtm-trust-kernel/adapters/salesforce.js';

const sf = new SalesforceAdapter(loadSalesforceConfigFromEnv());
const page = await sf.listOpportunitiesForSample({ asOf: new Date().toISOString(), closedWithinMonths: 12, limit: 200 });
```

**It never writes to Salesforce.** `capabilities().writeGranularity` is
`'none'`, and `applyFieldWrite()` always returns `rejected` without
calling the API. It signs in with a connected app (OAuth 2.0 client
credentials) and reads opportunities, contact roles, accounts, contacts,
Tasks, Events, Notes, Enhanced Notes and stage history. It passes the
shared contract suite against a live Developer Edition org.

Settings (environment variables):

| Variable | Required | Meaning |
|---|---|---|
| `SF_CLIENT_ID`, `SF_CLIENT_SECRET` | yes | The connected app's consumer key and secret |
| `SF_INSTANCE_URL` | yes | Your org's My Domain URL, e.g. `https://acme.my.salesforce.com` |
| `SF_API_VERSION` | no | Default `v62.0` |
| `SF_TOKEN_CACHE_PATH` | no | Where the access token is cached |
| `SF_ACTIVITY_CAPTURE` | no | `auto` if email/calendar sync logs activity; unset means `manual` |
| `SF_NOTE_FULLTEXT_FETCH_LIMIT` | no | Enhanced Note bodies fetched in full per run (default 200) |
| `SF_STAGE_MAP_PATH` | no | JSON file mapping your stage labels to the canonical stages |

Step-by-step org setup (connected app, Run As user permissions, seed
data): [Salesforce setup](https://github.com/pretzelslab/gtm-trust-kernel/blob/master/packages/readiness/docs/salesforce-setup.md).

## What it exports

The bare import resolves to types only; everything else is a subpath.

| Subpath | Contents |
|---|---|
| `@gtm-trust-kernel/adapters` (and `/types.js`) | `CrmAdapter`, `SecondSourceAdapter`, `AdapterCapabilities`, `AdapterError` and the supporting types |
| `/mock.js` | `MockAdapter`, `MockSecondSourceAdapter`: in-memory reference implementations |
| `/salesforce.js` | `SalesforceAdapter`, `loadSalesforceConfigFromEnv`, `loadStageMapFile` |
| `/model/canonical.js` | The canonical record model and `CANONICAL_STAGE_ORDER` |
| `/model/trust.js` | `TrustTier`, `tag()`: the trust envelope every free-text field is carried in |
| `/fixtures` | Mock data builders for tests (`makeMockAdapter`, `makeOrgData`, ...) |
| `/contract/adapter` | The `CrmAdapter` contract suite (**for adapter authors; needs `vitest`**) |
| `/contract/secondSource` | The `SecondSourceAdapter` contract suite (same) |

## For adapter authors: the contract suite

"CRM-agnostic" is something each adapter proves, not just claims. Run your
adapter through the same vitest suite the mock and Salesforce pass:

```ts
import { describe } from 'vitest';
import { runAdapterContract } from '@gtm-trust-kernel/adapters/contract/adapter';
import { makeMyAdapter } from './myAdapter.js';

describe('my-crm', () =>
  runAdapterContract(() => ({
    adapter: makeMyAdapter(),
    knownOpportunityId: '...', // ids that exist in your test org
    knownAccountId: '...',
    knownContactId: '...',
  })),
);
```

The suite deliberately tests the unhappy paths where adapters diverge:
pagination determinism, empty-not-throw for missing records and
undeclared capabilities, batch limits, quota accounting, concurrency and
idempotency of writes (skipped when `writeGranularity` is `'none'`).

Two optional knobs for CRMs with their own rules:

- `ContractHarness.unresolvableId(objectType, index?)`: return a
  well-formed id that names no record, if your adapter rejects ids not in
  its own format (Salesforce passes ids like `001000000000000AAA`).
- `AdapterCapabilities.minPageSize`: declare it if your CRM returns at
  least N rows per page whatever limit is asked (Salesforce: 200).

`vitest` (2.1.3 or later, below 6) is an optional peer dependency, needed
only for the `/contract/*` subpaths.

## Limitations

- Salesforce is the only real CRM so far, and it is read-only.
- Activity capture on Salesforce is declared (`SF_ACTIVITY_CAPTURE`), not
  detected.
- Activities logged only against a deal's contacts aren't counted yet.

## More

- [Changelog](https://github.com/pretzelslab/gtm-trust-kernel/blob/master/packages/adapters/CHANGELOG.md)
- [Security policy](https://github.com/pretzelslab/gtm-trust-kernel/blob/master/SECURITY.md)
- [The GTM trust kernel](https://github.com/pretzelslab/gtm-trust-kernel): the readiness report and the proposal kernel built on this package

## License

MIT
