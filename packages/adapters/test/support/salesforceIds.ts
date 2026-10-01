/**
 * Well-formed Salesforce ids that name no record, for the contract's
 * "unresolvable ref" checks (ContractHarness.unresolvableId). The adapter
 * refuses malformed ids outright, so those checks need ids in Salesforce's
 * own format: a 3-character key prefix, an all-zero body (with the index,
 * if any, in its last digits) and the 3-character case checksum, 18 in all.
 */

import type { CanonicalObjectType } from '../../src/model/canonical.js';

/** Key prefixes of the objects the adapter reads. The one place they are listed for tests. */
export const SALESFORCE_KEY_PREFIXES = {
  Account: '001',
  Contact: '003',
  Opportunity: '006',
  Task: '00T',
  Event: '00U',
} as const;

export type SalesforceObject = keyof typeof SALESFORCE_KEY_PREFIXES;

const CHECKSUM_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ012345';

/** The 3-character suffix that turns a 15-character id into its 18-character form. */
export function salesforceIdChecksum(id15: string): string {
  if (!/^[a-zA-Z0-9]{15}$/.test(id15)) throw new Error(`not a 15-character Salesforce id: ${id15}`);
  let suffix = '';
  for (let chunk = 0; chunk < 3; chunk += 1) {
    let bits = 0;
    for (let i = 0; i < 5; i += 1) {
      const ch = id15[chunk * 5 + i]!;
      if (ch >= 'A' && ch <= 'Z') bits |= 1 << i;
    }
    suffix += CHECKSUM_CHARS[bits];
  }
  return suffix;
}

/** An 18-character id of `object` that no org assigns: e.g. Account -> 001000000000000AAA. */
export function unresolvableSalesforceId(object: SalesforceObject, index = 0): string {
  const id15 = SALESFORCE_KEY_PREFIXES[object] + String(index).padStart(12, '0');
  return id15 + salesforceIdChecksum(id15);
}

/** The Salesforce object behind each canonical type the contract asks about (activities are Tasks). */
const OBJECT_FOR: Partial<Record<CanonicalObjectType, SalesforceObject>> = {
  account: 'Account',
  contact: 'Contact',
  opportunity: 'Opportunity',
  activity: 'Task',
};

/** ContractHarness.unresolvableId for SalesforceAdapter. */
export function unresolvableSalesforceIdFor(objectType: CanonicalObjectType, index?: number): string {
  const object = OBJECT_FOR[objectType];
  if (!object) throw new Error(`no Salesforce object for canonical type ${objectType}`);
  return unresolvableSalesforceId(object, index);
}
