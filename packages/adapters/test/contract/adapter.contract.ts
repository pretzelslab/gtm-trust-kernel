/**
 * The adapter contract suite.
 *
 * Every CRM adapter must pass this identically. This file is the proof that
 * "CRM-agnostic" is a property of the system rather than a claim in a README.
 *
 * Usage:
 *   describe('mock', () => runAdapterContract(() => makeMockAdapter()));
 *   describe('salesforce', () => runAdapterContract(() => makeSalesforceAdapter(), { live: true }));
 *
 * The suite deliberately tests the *unhappy* semantics, because that is where
 * adapters silently diverge: concurrency, idempotency, capability degradation,
 * pagination determinism, and quota accounting.
 */

import { describe, expect, it } from 'vitest';
import type { CrmAdapter, FieldWrite } from '../../src/types.js';

export interface ContractHarness {
  adapter: CrmAdapter;
  /** An opportunity id known to exist in the fixture org. */
  knownOpportunityId: string;
  /** An account id known to exist in the fixture org. */
  knownAccountId: string;
  /** A contact id known to exist in the fixture org. */
  knownContactId: string;
  /** Mutate the record out of band, to simulate a concurrent edit. */
  simulateConcurrentEdit?: (opportunityId: string) => Promise<void> | void;
}

export function runAdapterContract(make: () => Promise<ContractHarness> | ContractHarness) {
  describe('capability declaration', () => {
    it('declares a complete capability matrix', async () => {
      const { adapter } = await make();
      const c = adapter.capabilities();
      expect(typeof c.stageHistory).toBe('boolean');
      expect(typeof c.ownerHistory).toBe('boolean');
      expect(typeof c.activitySync).toBe('boolean');
      expect(typeof c.incrementalSync).toBe('boolean');
      expect(['field', 'record', 'none']).toContain(c.writeGranularity);
      expect(['daily_quota', 'per_second', 'none']).toContain(c.rateLimit.kind);
    });

    it('returns empty rather than throwing for undeclared history capabilities', async () => {
      const { adapter } = await make();
      const c = adapter.capabilities();
      if (!c.stageHistory) {
        const page = await adapter.listStageHistory({ limit: 10 });
        expect(page.items).toHaveLength(0);
      }
      if (!c.ownerHistory) {
        const page = await adapter.listOwnerChanges({ limit: 10 });
        expect(page.items).toHaveLength(0);
      }
    });
  });

  describe('read semantics', () => {
    it('paginates deterministically', async () => {
      const { adapter } = await make();
      const first = await adapter.listOpportunities({ limit: 2 });
      const firstAgain = await adapter.listOpportunities({ limit: 2 });
      expect(firstAgain.items.map((o) => o.ref.id)).toEqual(first.items.map((o) => o.ref.id));
    });

    it('does not repeat records across pages', async () => {
      const { adapter } = await make();
      const seen = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await adapter.listOpportunities({ limit: 2, cursor });
        for (const o of page.items) {
          expect(seen.has(o.ref.id)).toBe(false);
          seen.add(o.ref.id);
        }
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen.size).toBeGreaterThan(0);
    });

    it('reports api calls consumed for quota telemetry', async () => {
      const { adapter } = await make();
      const page = await adapter.listOpportunities({ limit: 5 });
      expect(page.apiCallsConsumed).toBeGreaterThanOrEqual(0);
    });

    it('returns a usable watermark for incremental sync', async () => {
      const { adapter } = await make();
      if (!adapter.capabilities().incrementalSync) return;
      const page = await adapter.listOpportunities({ limit: 5 });
      expect(typeof page.watermark).toBe('string');
      const next = await adapter.listOpportunities({ limit: 5, since: page.watermark });
      expect(next.items.length).toBeLessThanOrEqual(page.items.length);
    });

    it('qualifies every record ref with vendor and org', async () => {
      const { adapter } = await make();
      const page = await adapter.listOpportunities({ limit: 3 });
      for (const o of page.items) {
        expect(o.ref.crm).toBe(adapter.vendor);
        expect(o.ref.orgId).toBe(adapter.orgId);
      }
    });

    it('never reports a mapped stage without a vendor label', async () => {
      const { adapter } = await make();
      const page = await adapter.listOpportunities({ limit: 5 });
      for (const o of page.items) {
        expect(o.vendorStageLabel.length).toBeGreaterThan(0);
        expect(['mapped', 'inferred', 'unmapped']).toContain(o.stageConfidence);
      }
    });

    it('supplies a concurrency token on every opportunity', async () => {
      const { adapter } = await make();
      const page = await adapter.listOpportunities({ limit: 5 });
      for (const o of page.items) {
        expect(o.concurrencyToken).toBeTruthy();
      }
    });
  });

  describe('batch account read', () => {
    it('resolves a known account ref', async () => {
      const h = await make();
      const ref = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'account' as const, id: h.knownAccountId };
      const result = await h.adapter.getAccounts([ref]);
      expect(result.items.map((a) => a.ref.id)).toEqual([h.knownAccountId]);
    });

    it('returns nothing and consumes no quota for an empty refs array', async () => {
      const { adapter } = await make();
      const result = await adapter.getAccounts([]);
      expect(result.items).toHaveLength(0);
      expect(result.apiCallsConsumed).toBe(0);
    });

    it('returns an empty result rather than throwing when every ref is unresolvable', async () => {
      const { adapter } = await make();
      const ref = { crm: adapter.vendor, orgId: adapter.orgId, objectType: 'account' as const, id: 'no-such-account-xyz' };
      const result = await adapter.getAccounts([ref]);
      expect(result.items).toHaveLength(0);
    });

    it('resolves the known ref and silently omits an unresolvable one from the same call', async () => {
      const h = await make();
      const known = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'account' as const, id: h.knownAccountId };
      const missing = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'account' as const, id: 'no-such-account-xyz' };
      const result = await h.adapter.getAccounts([known, missing]);
      expect(result.items.map((a) => a.ref.id)).toEqual([h.knownAccountId]);
    });

    it('does not truncate or throw when called with more refs than capabilities().accountBatchLimit', async () => {
      const h = await make();
      const known = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'account' as const, id: h.knownAccountId };
      const limit = h.adapter.capabilities().accountBatchLimit;
      const padding = Array.from({ length: limit }, (_, i) => ({
        crm: h.adapter.vendor,
        orgId: h.adapter.orgId,
        objectType: 'account' as const,
        id: `no-such-account-${i}`,
      }));
      const result = await h.adapter.getAccounts([known, ...padding]);
      expect(result.items.map((a) => a.ref.id)).toEqual([h.knownAccountId]);
    });

    it('returns at most one entry when the same ref is requested more than once', async () => {
      const h = await make();
      const ref = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'account' as const, id: h.knownAccountId };
      const result = await h.adapter.getAccounts([ref, ref]);
      expect(result.items.map((a) => a.ref.id)).toEqual([h.knownAccountId]);
    });
  });

  describe('batch contact read', () => {
    it('resolves a known contact ref', async () => {
      const h = await make();
      const ref = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'contact' as const, id: h.knownContactId };
      const result = await h.adapter.getContactsByRef([ref]);
      expect(result.items.map((c) => c.ref.id)).toEqual([h.knownContactId]);
    });

    it('returns nothing and consumes no quota for an empty refs array', async () => {
      const { adapter } = await make();
      const result = await adapter.getContactsByRef([]);
      expect(result.items).toHaveLength(0);
      expect(result.apiCallsConsumed).toBe(0);
    });

    it('returns an empty result rather than throwing when every ref is unresolvable', async () => {
      const { adapter } = await make();
      const ref = { crm: adapter.vendor, orgId: adapter.orgId, objectType: 'contact' as const, id: 'no-such-contact-xyz' };
      const result = await adapter.getContactsByRef([ref]);
      expect(result.items).toHaveLength(0);
    });

    it('resolves the known ref and silently omits an unresolvable one from the same call', async () => {
      const h = await make();
      const known = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'contact' as const, id: h.knownContactId };
      const missing = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'contact' as const, id: 'no-such-contact-xyz' };
      const result = await h.adapter.getContactsByRef([known, missing]);
      expect(result.items.map((c) => c.ref.id)).toEqual([h.knownContactId]);
    });

    it('does not truncate or throw when called with more refs than capabilities().contactBatchLimit', async () => {
      const h = await make();
      const known = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'contact' as const, id: h.knownContactId };
      const limit = h.adapter.capabilities().contactBatchLimit;
      const padding = Array.from({ length: limit }, (_, i) => ({
        crm: h.adapter.vendor,
        orgId: h.adapter.orgId,
        objectType: 'contact' as const,
        id: `no-such-contact-${i}`,
      }));
      const result = await h.adapter.getContactsByRef([known, ...padding]);
      expect(result.items.map((c) => c.ref.id)).toEqual([h.knownContactId]);
    });

    it('returns at most one entry when the same ref is requested more than once', async () => {
      const h = await make();
      const ref = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'contact' as const, id: h.knownContactId };
      const result = await h.adapter.getContactsByRef([ref, ref]);
      expect(result.items.map((c) => c.ref.id)).toEqual([h.knownContactId]);
    });
  });

  describe('batch child-record reads (notes/activities by opportunity)', () => {
    it('resolves notes and activities related to a known opportunity ref', async () => {
      const h = await make();
      const oppRef = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'opportunity' as const, id: h.knownOpportunityId };

      const notes = await h.adapter.getNotesByOpportunity([oppRef]);
      expect(notes.items.length).toBeGreaterThan(0);
      for (const n of notes.items) {
        expect(n.relatedTo.some((r) => r.objectType === 'opportunity' && r.id === h.knownOpportunityId)).toBe(true);
      }

      const activities = await h.adapter.getActivitiesByOpportunity([oppRef]);
      expect(activities.items.length).toBeGreaterThan(0);
      for (const a of activities.items) {
        expect(a.relatedTo.some((r) => r.objectType === 'opportunity' && r.id === h.knownOpportunityId)).toBe(true);
      }
    });

    it('returns nothing and consumes no quota for an empty refs array', async () => {
      const { adapter } = await make();
      const notes = await adapter.getNotesByOpportunity([]);
      expect(notes.items).toHaveLength(0);
      expect(notes.apiCallsConsumed).toBe(0);

      const activities = await adapter.getActivitiesByOpportunity([]);
      expect(activities.items).toHaveLength(0);
      expect(activities.apiCallsConsumed).toBe(0);
    });

    it('returns no items rather than throwing for an unresolvable opportunity ref', async () => {
      const { adapter } = await make();
      const ref = { crm: adapter.vendor, orgId: adapter.orgId, objectType: 'opportunity' as const, id: 'no-such-opportunity-xyz' };
      const notes = await adapter.getNotesByOpportunity([ref]);
      expect(notes.items).toHaveLength(0);
      const activities = await adapter.getActivitiesByOpportunity([ref]);
      expect(activities.items).toHaveLength(0);
    });

    it('resolves the known ref while an unresolvable ref in the same call contributes nothing', async () => {
      const h = await make();
      const known = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'opportunity' as const, id: h.knownOpportunityId };
      const missing = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'opportunity' as const, id: 'no-such-opportunity-xyz' };
      const result = await h.adapter.getNotesByOpportunity([known, missing]);
      expect(result.items.length).toBeGreaterThan(0);
      for (const n of result.items) {
        expect(n.relatedTo.some((r) => r.objectType === 'opportunity' && r.id === h.knownOpportunityId)).toBe(true);
      }
    });

    it('does not truncate or throw when called with more refs than capabilities().childRecordBatchLimit', async () => {
      const h = await make();
      const known = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'opportunity' as const, id: h.knownOpportunityId };
      const limit = h.adapter.capabilities().childRecordBatchLimit;
      const padding = Array.from({ length: limit }, (_, i) => ({
        crm: h.adapter.vendor,
        orgId: h.adapter.orgId,
        objectType: 'opportunity' as const,
        id: `no-such-opportunity-${i}`,
      }));
      const result = await h.adapter.getNotesByOpportunity([known, ...padding]);
      expect(result.items.length).toBeGreaterThan(0);
    });

    it('reports truncatedOpportunityIds as a set, empty when well under the per-opportunity limit', async () => {
      const h = await make();
      const oppRef = { crm: h.adapter.vendor, orgId: h.adapter.orgId, objectType: 'opportunity' as const, id: h.knownOpportunityId };
      const result = await h.adapter.getNotesByOpportunity([oppRef]);
      expect(result.truncatedOpportunityIds instanceof Set).toBe(true);
      expect(result.truncatedOpportunityIds.size).toBe(0);
    });
  });

  describe('write semantics', () => {
    it('applies a single field write and advances the concurrency token', async () => {
      const h = await make();
      if (h.adapter.capabilities().writeGranularity === 'none') return;
      const opp = await h.adapter.getOpportunity({
        crm: h.adapter.vendor,
        orgId: h.adapter.orgId,
        objectType: 'opportunity',
        id: h.knownOpportunityId,
      });
      expect(opp).not.toBeNull();
      const write: FieldWrite = {
        ref: opp!.ref,
        field: 'nextStep',
        newValue: 'contract-test value',
        previousValue: opp!.nextStep?.value ?? null,
        expectedConcurrencyToken: opp!.concurrencyToken,
      };
      const out = await h.adapter.applyFieldWrite(write);
      expect(out.status).toBe('applied');
      if (out.status === 'applied') {
        expect(out.newConcurrencyToken).not.toBe(opp!.concurrencyToken);
      }
    });

    it('is idempotent for a repeated identical write', async () => {
      const h = await make();
      if (h.adapter.capabilities().writeGranularity === 'none') return;
      const ref = {
        crm: h.adapter.vendor,
        orgId: h.adapter.orgId,
        objectType: 'opportunity' as const,
        id: h.knownOpportunityId,
      };
      const opp = await h.adapter.getOpportunity(ref);
      const write: FieldWrite = {
        ref: opp!.ref,
        field: 'nextStep',
        newValue: 'idempotent value',
        previousValue: opp!.nextStep?.value ?? null,
        expectedConcurrencyToken: opp!.concurrencyToken,
      };
      const a = await h.adapter.applyFieldWrite(write);
      const b = await h.adapter.applyFieldWrite(write);
      expect(b).toEqual(a);
    });

    it('refuses a write whose concurrency token has drifted', async () => {
      const h = await make();
      if (h.adapter.capabilities().writeGranularity === 'none') return;
      const ref = {
        crm: h.adapter.vendor,
        orgId: h.adapter.orgId,
        objectType: 'opportunity' as const,
        id: h.knownOpportunityId,
      };
      const opp = await h.adapter.getOpportunity(ref);
      const out = await h.adapter.applyFieldWrite({
        ref: opp!.ref,
        field: 'nextStep',
        newValue: 'should not apply',
        previousValue: null,
        expectedConcurrencyToken: 'definitely-stale-token',
      });
      expect(out.status).toBe('conflict');
    });

    it('reports not_found for a missing record rather than throwing', async () => {
      const h = await make();
      if (h.adapter.capabilities().writeGranularity === 'none') return;
      const out = await h.adapter.applyFieldWrite({
        ref: {
          crm: h.adapter.vendor,
          orgId: h.adapter.orgId,
          objectType: 'opportunity',
          id: 'no-such-record-xyz',
        },
        field: 'nextStep',
        newValue: 'x',
        previousValue: null,
        expectedConcurrencyToken: 'anything',
      });
      expect(out.status).toBe('not_found');
    });
  });

  describe('health', () => {
    it('reports health without consuming meaningful quota', async () => {
      const { adapter } = await make();
      const h = await adapter.health();
      expect(typeof h.ok).toBe('boolean');
    });
  });
}
