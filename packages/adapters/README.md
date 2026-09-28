# @gtm-trust-kernel/adapters

CRM adapter contract, canonical model and trust envelope, and the mock
adapter — the CRM-agnostic layer of the
[GTM trust kernel](https://github.com/pretzelslab/gtm-trust-kernel).

## What it exports

Subpath exports only (no bare `@gtm-trust-kernel/adapters` import):

| Subpath | Contents |
|---|---|
| `@gtm-trust-kernel/adapters/types.js` | `CrmAdapter`, `SecondSourceAdapter` interfaces and their supporting types (`AdapterCapabilities`, `FieldWrite`, `SecondSourceCapabilities`, etc.) |
| `@gtm-trust-kernel/adapters/mock.js` | `MockAdapter`, `MockSecondSourceAdapter` — in-memory reference implementations, useful for testing against the contract without a real CRM |
| `@gtm-trust-kernel/adapters/salesforce.js` | `SalesforceAdapter`, `loadSalesforceConfigFromEnv` |
| `@gtm-trust-kernel/adapters/model/canonical.js` | The canonical CRM record model (`Account`, `Contact`, `Opportunity`, `Activity`, `Note`, stage history types, `CANONICAL_STAGE_ORDER`) |
| `@gtm-trust-kernel/adapters/model/trust.js` | `TrustTier`, `tag()` — the trust-envelope wrapper every free-text field is carried in |
| `@gtm-trust-kernel/adapters/test/fixtures.js` | Shared mock-data builders (`makeMockAdapter`, `makeMockSecondSourceAdapter`, `makeOrgData`, `makeSecondSourceOrgData`, `makeEvidenceSet`) |
| `@gtm-trust-kernel/adapters/test/contract/adapter.contract.js` | The `CrmAdapter` contract suite |
| `@gtm-trust-kernel/adapters/test/contract/secondSource.contract.js` | The `SecondSourceAdapter` contract suite |

## The adapter contract

"CRM-agnostic" is a property this package proves, not just claims. Anyone
implementing a new `CrmAdapter` (or `SecondSourceAdapter`) runs their
implementation through the same shared vitest suite every existing adapter
passes:

```ts
import { describe } from 'vitest';
import { runAdapterContract } from '@gtm-trust-kernel/adapters/test/contract/adapter.contract.js';
import { makeMyAdapter } from './myAdapter.js';

describe('my-crm', () => runAdapterContract(() => makeMyAdapter()));
```

`runAdapterContract` takes a factory returning a `ContractHarness` (your
adapter instance plus known record ids from your fixture org) and registers
`describe`/`it` blocks — it must be called from inside a vitest test file,
not run standalone. `runSecondSourceContract`
(`test/contract/secondSource.contract.js`) is the equivalent suite for
`SecondSourceAdapter` implementations, taking a `SecondSourceContractHarness`.

Both suites deliberately test the *unhappy* paths — concurrency, idempotency,
capability degradation, pagination determinism, quota accounting — since
that's where adapters silently diverge.

### `vitest` peer dependency

The contract-suite subpaths (`test/contract/*.js`) import `describe`/
`expect`/`it` from `vitest`, declared as an **optional peer dependency**.
You only need `vitest` installed if you actually import one of those two
subpaths to run the contract suite against your own adapter — importing
`mock.js`, `types.js`, or any of the other subpaths never requires it.

## More

Part of the [gtm-trust-kernel](https://github.com/pretzelslab/gtm-trust-kernel)
monorepo — see that repo for the full readiness methodology and the
`gtm-trust-kernel` CLI built on top of this package.
