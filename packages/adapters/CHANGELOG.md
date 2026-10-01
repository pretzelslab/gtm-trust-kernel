# Changelog

All notable changes to `@gtm-trust-kernel/adapters`. Versions follow
semver; before 1.0, a minor version may include changes that break
adapter authors, and each one is listed under "Breaking".

## 0.2.0 (unreleased)

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
