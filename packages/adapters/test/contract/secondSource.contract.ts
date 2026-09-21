/**
 * The second-source adapter contract suite (D5 cross-system joinability).
 * Design locked in packages/readiness/docs/second-source-adapter-design.md.
 *
 * Every SecondSourceAdapter must pass this identically — same purpose as
 * adapter.contract.ts for CrmAdapter. Only one implementation
 * (MockSecondSourceAdapter) exists today; this suite is still written
 * adapter-agnostic, same as the CRM suite was before a second CRM adapter
 * existed.
 *
 * Usage:
 *   describe('mock', () => runSecondSourceContract(() => makeMockSecondSourceAdapter()));
 */

import { describe, expect, it } from 'vitest';
import type { SecondSourceAdapter, SecondSourceCapabilities, SecondSourceRef } from '../../src/types.js';

export interface SecondSourceContractHarness {
  adapter: SecondSourceAdapter;
  /** Identifies the fixture's refs — SecondSourceAdapter itself exposes no vendor/org identity, unlike CrmAdapter. */
  source: string;
  orgId: string;
  /** A contact id known to exist in the fixture second source. */
  knownContactId: string;
  /** An account id known to exist in the fixture second source. */
  knownAccountId: string;
  /**
   * Construct a variant of the same adapter with the given capability
   * overrides. Optional — only used by the has*-false gate-off tests,
   * same "declared but conditionally exercised" pattern as
   * ContractHarness.simulateConcurrentEdit in adapter.contract.ts.
   */
  withCapabilities?: (overrides: Partial<SecondSourceCapabilities>) => SecondSourceAdapter | Promise<SecondSourceAdapter>;
}

export function runSecondSourceContract(make: () => Promise<SecondSourceContractHarness> | SecondSourceContractHarness) {
  const ref = (h: SecondSourceContractHarness, objectType: SecondSourceRef['objectType'], id: string): SecondSourceRef => ({
    source: h.source,
    orgId: h.orgId,
    objectType,
    id,
  });

  describe('capability declaration', () => {
    it('declares a complete capability matrix', async () => {
      const { adapter } = await make();
      const c = adapter.capabilities();
      expect(['engagement', 'billing']).toContain(c.kind);
      expect(typeof c.hasContacts).toBe('boolean');
      expect(typeof c.hasAccounts).toBe('boolean');
      expect(typeof c.hasActivities).toBe('boolean');
      expect(typeof c.refBatchLimit).toBe('number');
      expect(typeof c.activitiesPerRefLimit).toBe('number');
      expect(typeof c.maxSampleSizePerType).toBe('number');
    });
  });

  describe('capability gate-off (has* : false)', () => {
    it('listContacts/getContactsByRef return empty, not throw, when hasContacts is false', async () => {
      const h = await make();
      if (!h.withCapabilities) return;
      const adapter = await h.withCapabilities({ hasContacts: false });

      const page = await adapter.listContacts({ limit: 10 });
      expect(page.items).toHaveLength(0);

      const byRef = await adapter.getContactsByRef([ref(h, 'contact', h.knownContactId)]);
      expect(byRef.items).toHaveLength(0);
    });

    it('listAccounts/getAccountsByRef return empty, not throw, when hasAccounts is false', async () => {
      const h = await make();
      if (!h.withCapabilities) return;
      const adapter = await h.withCapabilities({ hasAccounts: false });

      const page = await adapter.listAccounts({ limit: 10 });
      expect(page.items).toHaveLength(0);

      const byRef = await adapter.getAccountsByRef([ref(h, 'account', h.knownAccountId)]);
      expect(byRef.items).toHaveLength(0);
    });

    it('listActivities/getActivitiesByRef return empty, not throw, when hasActivities is false', async () => {
      const h = await make();
      if (!h.withCapabilities) return;
      const adapter = await h.withCapabilities({ hasActivities: false });

      const page = await adapter.listActivities({ limit: 10 });
      expect(page.items).toHaveLength(0);

      const byRef = await adapter.getActivitiesByRef([ref(h, 'contact', h.knownContactId)]);
      expect(byRef.items).toHaveLength(0);
    });
  });

  describe('list* read semantics', () => {
    it('paginates deterministically', async () => {
      const { adapter } = await make();
      const first = await adapter.listContacts({ limit: 2 });
      const firstAgain = await adapter.listContacts({ limit: 2 });
      expect(firstAgain.items.map((c) => c.ref.id)).toEqual(first.items.map((c) => c.ref.id));
    });

    it('does not repeat records across pages', async () => {
      const { adapter } = await make();
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await adapter.listContacts({ limit: 2, cursor });
        for (const c of page.items) {
          expect(seen.has(c.ref.id)).toBe(false);
          seen.add(c.ref.id);
        }
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen.size).toBeGreaterThan(0);
    });

    it('reports api calls consumed for quota telemetry', async () => {
      const { adapter } = await make();
      const page = await adapter.listContacts({ limit: 5 });
      expect(page.apiCallsConsumed).toBeGreaterThanOrEqual(0);
    });

    it('returns a usable watermark', async () => {
      const { adapter } = await make();
      const page = await adapter.listContacts({ limit: 5 });
      expect(typeof page.watermark).toBe('string');
      const next = await adapter.listContacts({ limit: 5, since: page.watermark });
      expect(next.items.length).toBeLessThanOrEqual(page.items.length);
    });
  });

  describe('batch contact/account ref reads', () => {
    it('resolves a known contact ref', async () => {
      const h = await make();
      const result = await h.adapter.getContactsByRef([ref(h, 'contact', h.knownContactId)]);
      expect(result.items.map((c) => c.ref.id)).toEqual([h.knownContactId]);
    });

    it('resolves a known account ref', async () => {
      const h = await make();
      const result = await h.adapter.getAccountsByRef([ref(h, 'account', h.knownAccountId)]);
      expect(result.items.map((a) => a.ref.id)).toEqual([h.knownAccountId]);
    });

    it('returns nothing and consumes no quota for an empty refs array', async () => {
      const { adapter } = await make();
      const contacts = await adapter.getContactsByRef([]);
      expect(contacts.items).toHaveLength(0);
      expect(contacts.apiCallsConsumed).toBe(0);

      const accounts = await adapter.getAccountsByRef([]);
      expect(accounts.items).toHaveLength(0);
      expect(accounts.apiCallsConsumed).toBe(0);
    });

    it('returns an empty result rather than throwing when every ref is unresolvable', async () => {
      const h = await make();
      const result = await h.adapter.getContactsByRef([ref(h, 'contact', 'no-such-contact-xyz')]);
      expect(result.items).toHaveLength(0);
    });

    it('resolves the known ref while an unresolvable ref in the same call contributes nothing', async () => {
      const h = await make();
      const result = await h.adapter.getContactsByRef([ref(h, 'contact', h.knownContactId), ref(h, 'contact', 'no-such-contact-xyz')]);
      expect(result.items.map((c) => c.ref.id)).toEqual([h.knownContactId]);
    });

    it('returns at most one entry when the same ref is requested more than once', async () => {
      const h = await make();
      const r = ref(h, 'contact', h.knownContactId);
      const result = await h.adapter.getContactsByRef([r, r]);
      expect(result.items.map((c) => c.ref.id)).toEqual([h.knownContactId]);
    });

    it('does not truncate or throw when called with more refs than capabilities().refBatchLimit', async () => {
      const h = await make();
      const known = ref(h, 'contact', h.knownContactId);
      const limit = h.adapter.capabilities().refBatchLimit;
      const padding = Array.from({ length: limit }, (_, i) => ref(h, 'contact', `no-such-contact-${i}`));
      const result = await h.adapter.getContactsByRef([known, ...padding]);
      expect(result.items.map((c) => c.ref.id)).toEqual([h.knownContactId]);
    });
  });

  describe('batch activity ref reads', () => {
    it('returns nothing and consumes no quota for an empty refs array', async () => {
      const { adapter } = await make();
      const result = await adapter.getActivitiesByRef([]);
      expect(result.items).toHaveLength(0);
      expect(result.apiCallsConsumed).toBe(0);
    });

    it('returns no items rather than throwing for an unresolvable ref', async () => {
      const h = await make();
      const result = await h.adapter.getActivitiesByRef([ref(h, 'contact', 'no-such-contact-xyz')]);
      expect(result.items).toHaveLength(0);
    });

    it('reports truncatedRefIds as a set, empty when well under the per-ref limit', async () => {
      const h = await make();
      const result = await h.adapter.getActivitiesByRef([ref(h, 'contact', h.knownContactId)]);
      expect(result.truncatedRefIds instanceof Set).toBe(true);
      expect(result.truncatedRefIds.size).toBe(0);
    });
  });
}
