# @gtm-trust-kernel/adapters

## What is this

A CRM adapter is a small piece of code that lets the trust kernel read from, and safely write to, one particular CRM. This package defines the shared rules every adapter must follow, plus a fake in-memory CRM for testing. Every adapter is meant to pass the same tests, so the health check works the same way whichever CRM sits underneath. A read-only Salesforce adapter is included (experimental: unit-tested against a fake Salesforce API, not yet validated on a live org), and other CRMs can be added via adapters.

## Who it's for

- **Developers** adding support for a new CRM, or testing against the mock one.
- **Non-developers**: this is a building block. To just check your CRM's health, use the [`gtm-trust-kernel` CLI](https://www.npmjs.com/package/gtm-trust-kernel).

## Try it in 1 minute

You don't install this package to see it work. It powers the CLI's demo (Node.js 22 or newer required):

```bash
npx gtm-trust-kernel scan --demo
```

It uses a built-in sample CRM, so it doesn't connect to any real CRM. You'll see a sampling plan in the terminal, and the health report is written to `./out` (open `out/latest.html`). Add `--json` to print the report data to stdout, or `--narrative` (needs `ANTHROPIC_API_KEY`; sends report data to Anthropic's API) for an AI-written summary.

## Reference

CRM adapter contract, canonical model and trust envelope, and the mock
adapter — the CRM-agnostic layer of the
[GTM trust kernel](https://github.com/pretzelslab/gtm-trust-kernel).

### What it exports

The bare `@gtm-trust-kernel/adapters` import resolves to `types.js` only (types and interfaces, no runtime code, and no contract suites); everything else is a subpath:

| Subpath | Contents |
|---|---|
| `@gtm-trust-kernel/adapters` (and `/types.js`) | `CrmAdapter`, `SecondSourceAdapter` interfaces and their supporting types (`AdapterCapabilities`, `FieldWrite`, `SecondSourceCapabilities`, etc.) |
| `@gtm-trust-kernel/adapters/mock.js` | `MockAdapter`, `MockSecondSourceAdapter` — in-memory reference implementations, useful for testing against the contract without a real CRM |
| `@gtm-trust-kernel/adapters/salesforce.js` | `SalesforceAdapter`, `loadSalesforceConfigFromEnv`, `loadStageMapFile` (reads the `SF_STAGE_MAP_PATH` file) |
| `@gtm-trust-kernel/adapters/model/canonical.js` | The canonical CRM record model (`Account`, `Contact`, `Opportunity`, `Activity`, `Note`, stage history types, `CANONICAL_STAGE_ORDER`) |
| `@gtm-trust-kernel/adapters/model/trust.js` | `TrustTier`, `tag()` — the trust-envelope wrapper every free-text field is carried in |
| `@gtm-trust-kernel/adapters/fixtures` | Shared mock-data builders (`makeMockAdapter`, `makeMockSecondSourceAdapter`, `makeOrgData`, `makeSecondSourceOrgData`, `makeEvidenceSet`) |
| `@gtm-trust-kernel/adapters/contract/adapter` | The `CrmAdapter` contract suite. **Requires `vitest`** (optional peer dependency) |
| `@gtm-trust-kernel/adapters/contract/secondSource` | The `SecondSourceAdapter` contract suite. **Requires `vitest`** (optional peer dependency) |

### The adapter contract

"CRM-agnostic" is a property this package proves, not just claims. Anyone
implementing a new `CrmAdapter` (or `SecondSourceAdapter`) runs their
implementation through the same shared vitest suite every existing adapter
passes:

```ts
import { describe } from 'vitest';
import { runAdapterContract } from '@gtm-trust-kernel/adapters/contract/adapter';
import { makeMyAdapter } from './myAdapter.js';

describe('my-crm', () => runAdapterContract(() => makeMyAdapter()));
```

`runAdapterContract` takes a factory returning a `ContractHarness` (your
adapter instance plus known record ids from your fixture org) and registers
`describe`/`it` blocks — it must be called from inside a vitest test file,
not run standalone. `runSecondSourceContract`
(`@gtm-trust-kernel/adapters/contract/secondSource`) is the equivalent suite for
`SecondSourceAdapter` implementations, taking a `SecondSourceContractHarness`.

`vitest` is an optional peer dependency: it is only needed if you import
`./contract/*`. The runtime entries (`.`, `types.js`, `mock.js`, `salesforce.js`,
`model/*`, `fixtures`) never import it.

Both suites deliberately test the *unhappy* paths — concurrency, idempotency,
capability degradation, pagination determinism, quota accounting — since
that's where adapters silently diverge.

#### `vitest` peer dependency

The contract-suite subpaths (`./contract/*`) import `describe`/
`expect`/`it` from `vitest`, declared as an **optional peer dependency**.
You only need `vitest` installed if you actually import one of those two
subpaths to run the contract suite against your own adapter — importing
`mock.js`, `types.js`, or any of the other subpaths never requires it.

### More

Part of the gtm-trust-kernel monorepo — see
<https://github.com/pretzelslab/gtm-trust-kernel> for the full readiness
methodology and the `gtm-trust-kernel` CLI built on top of this package.
