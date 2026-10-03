/**
 * Registers what SalesforceAdapter.preflight() asks the fake API for: the
 * global describe and one describe per object in SALESFORCE_READS, with
 * every field the adapter reads unless hidden.
 */

import { SALESFORCE_READS } from '../../src/salesforce.js';
import type { FakeSalesforce } from './fakeSalesforce.js';

export interface PreflightOrgOptions {
  /** Objects the Run As user can't query (queryable false in the global describe). */
  readonly unreadable?: readonly string[];
  /** Fields left out of an object's describe, as field-level security does. */
  readonly hiddenFields?: Readonly<Record<string, readonly string[]>>;
}

export function registerPreflightOrg(sf: FakeSalesforce, options: PreflightOrgOptions = {}): void {
  const unreadable = new Set(options.unreadable ?? []);
  sf.globalDescribe([
    ...SALESFORCE_READS.map((r) => ({ name: r.object, queryable: !unreadable.has(r.object) })),
    { name: 'Lead', queryable: true },
  ]);
  for (const read of SALESFORCE_READS) {
    const hidden = new Set(options.hiddenFields?.[read.object] ?? []);
    sf.sobjectDescribe(read.object, {
      name: read.object,
      queryable: !unreadable.has(read.object),
      fields: [...read.fields.filter((f) => !hidden.has(f)), 'LastModifiedDate'].map((name) => ({ name, type: 'string' })),
    });
  }
}
