# Changelog

All notable changes to `@gtm-trust-kernel/adapters`. Versions follow
semver; before 1.0, a minor version may include changes that break
adapter authors, and each one is listed under "Breaking".

## 0.3.0 (unreleased)

Planned as 0.2.1; the reliability changes below make it 0.3.0.
`package.json` still says 0.2.1 until the release is packed, right before
the repository goes public.

### Breaking

- **The org's daily `REQUEST_LIMIT_EXCEEDED` is now a `rate_limit`
  error, not `permission`.** Salesforce answers it with a 403, which
  `SalesforceAdapter` used to report as `AdapterError` with
  `kind: 'permission'`. It is now `kind: 'rate_limit'`,
  `retryable: false`, with a message saying the daily limit is used up.
  Code that switches on `kind` sees the change.
- `SalesforceAdapter` calls can now take longer: a throttled request is
  retried with waits of up to 60 seconds in total before it fails (see
  Added).

### Added

- **Retry with backoff** in `SalesforceAdapter`: a 429, a 503, or a
  "concurrent requests" `REQUEST_LIMIT_EXCEEDED` (403) is retried with
  exponential backoff and full jitter, honouring `Retry-After`: 4
  attempts, 1 s base, 30 s per wait, 60 s in total. Token requests use the
  same loop; a retried page of a paged query re-sends only that page.
  When retries run out, the error says so in one sentence, without the
  response body. Auth and other 4xx errors are never retried.
- `SalesforceAdapter`'s constructor takes an optional second argument,
  `SalesforceAdapterDeps`: `sleep`, `random` and `onRetry` (called before
  each wait with a `RetryInfo`; the adapter prints nothing itself).
- **`CrmAdapter.preflight?(options)`** (optional): checks before any read,
  returning `PreflightResult` (`failures`, `warnings`, `apiCallsConsumed`)
  of `PreflightIssue`s, one plain sentence each. `SalesforceAdapter`
  checks the token, the API version, object access (global describe) and
  field-level security (one describe per object), reading no records, at
  most 13 calls. Required: Opportunity, Account, OpportunityContactRole,
  Task, Event, OpportunityHistory, and Contact with
  `{ contacts: true }`. Note, ContentDocumentLink and ContentNote are
  warnings: their queries are skipped and `notesComplete` is false.
  Messages carry Salesforce error codes, never response text. Preflight
  calls are not part of `apiCallEstimate`.
- `SALESFORCE_READS`: every object and field the adapter reads, and how
  much a scan needs each (also a least-privilege permission list).
  `NOTE_OBJECTS_ACCESS_HINT` is the setting hint when preflight finds Note
  or ContentDocumentLink unreadable.
- **The org's daily API usage.** `SalesforceAdapter` reads it from the
  `Sforce-Limit-Info` header on each response (`parseLimitInfo`), or from
  `/limits` when no response carried it. `AdapterCapabilities.rateLimit`
  gains optional `remaining`, `reserve` and `source` (`'org'` or
  `'estimate'`); until the org reports, it is the 15,000 estimate as
  before. The adapter keeps 10% of the daily maximum in reserve
  (`DAILY_LIMIT_RESERVE_FRACTION`, `dailyLimitReserve`) and stops before
  a call once the calls left reach it, with a non-retryable `rate_limit`
  error. Preflight reports an org already at the reserve as an
  `api_limit` failure.

### Changed

- `probe()` makes no call when `preflight()` already checked
  `ContentNote`.
- `health()` records the daily usage `/limits` returns, and is not stopped
  by the reserve.
- `notesComplete` can also be false because preflight found Note or
  ContentDocumentLink unreadable.

### Fixed

- `MockAdapter` fault injection (`failListOnCall`, `failGetAccountsOnCall`,
  `failGetContactsOnCall`) threw `ReferenceError: require is not defined`
  under Node's ESM loader instead of the intended `AdapterError`. It now
  throws `AdapterError` with the requested `kind`.

### Changed

- **Token cache location.** The Salesforce access token is now cached in
  the user's config folder (`%LOCALAPPDATA%\gtm-trust-kernel` on Windows,
  `~/Library/Application Support/gtm-trust-kernel` on macOS,
  `$XDG_CONFIG_HOME` or `~/.config/gtm-trust-kernel` elsewhere), one file
  per org and connected app, instead of inside the package folder. On
  macOS and Linux the file is 0600 and a folder it creates 0700.
  `SF_TOKEN_CACHE_PATH` still overrides it. The old file is deleted on
  first use, not migrated, so the first run after upgrading fetches one
  new token. `SalesforceConfig` is unchanged.
- The optional `vitest` peer dependency (for the `/contract/*` suites) is
  widened from `^2.1.3` to `>=2.1.3 <6`, so adapter authors on vitest 3, 4
  or 5 no longer get a peer conflict.
- README rewritten: install, a runnable quickstart, Salesforce settings,
  the contract suite for adapter authors, ESM-only, limitations. Sharper
  package description and keywords.

## 0.2.0 (2026-10-02)

### Added: contract support for adapters with their own id or page rules (optional, additive)

- `AdapterCapabilities.minPageSize?: number`: the smallest page a list
  call returns while more rows remain; a smaller requested limit is
  raised to it. Default 1 (every limit honoured exactly). The Salesforce
  adapter declares 200, Salesforce's minimum query batch size. The mock
  adapter honours it when set. The contract's listing check allows
  `max(limit, minPageSize)` items on a page.
- `ContractHarness.unresolvableId?: (objectType, index?) => string` in
  the contract suite (`./contract/adapter`): a well-formed id that names
  no record, for the "unresolvable ref" checks, for adapters that reject
  ids not in their own format. Defaults to the previous
  `no-such-<objectType>-xyz` (or `-<index>`) strings, so existing
  harnesses and their results are unchanged.

### Breaking (for adapter authors)

- `CrmAdapter` gains two required methods for the readiness sample:
  `listOpportunitiesForSample(window)` (open deals plus deals closed in
  the window, newest created first, ties by id descending) and
  `countOpportunitiesForSample(population)`, with the new types
  `SamplePopulation`, `SampleWindow`, `SamplePage` and
  `SamplePopulationCount`. A custom adapter must implement both.

### Added

- Optional capabilities: `apiCallEstimate` (calls per run, per scan
  page, per sampled deal, per child-record batch, and a fetch cap, for
  the printed plan), `settingHints`, `stageMapHint` and `notesComplete`.
- `Note.bodyTruncated` and `StageHistoryEntry.toStageConfidence`
  (optional fields).
- Salesforce adapter: Enhanced Notes (`ContentNote`) and Events
  (meetings); `SF_ACTIVITY_CAPTURE`; custom stage mapping from a JSON file
  (`SF_STAGE_MAP_PATH`, `loadStageMapFile`); `SF_NOTE_FULLTEXT_FETCH_LIMIT`.

### Changed

- Salesforce adapter: Notes, Tasks, Events and stage history are read
  through parent-child subqueries batched by opportunity id (a 35-deal
  org went from 132 to 12 API calls per readiness run); Tasks are
  classified by `TaskSubtype`; opportunity contact roles are loaded with
  each listing page; unreadable Enhanced Notes are reported, never a
  failed run.

## 0.1.0

First release: the CRM adapter contract and canonical model, the trust
envelope, the mock adapter, and the read-only Salesforce adapter.
