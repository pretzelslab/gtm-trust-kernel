/**
 * Redaction canary test (Phase E closeout — see docs/redaction-review.md and
 * claude/gtm-readiness-scope.md's decision log). This is not a metrics test:
 * it seeds a fake-PII/injection "canary" fragment into every text-bearing
 * field of every CRM and second-source record (cloned from the `healthy`
 * fixture, never mutating it), runs the real production pipeline, and
 * asserts none of the fragments survive into any shipped output surface.
 *
 * Assertions are on normalized substrings ("canaryton", "redactiontest",
 * "canary1234", "canaryxss", "5550199", the repo's own canonical
 * GTMK-CANARY-7F3A token normalized), not full literal strings — a fragment
 * survives HTML-escaping, quoting, and whitespace changes that would defeat
 * an exact-string check, so this catches partial/escaped leaks too.
 */

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MockAdapter, MockSecondSourceAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import { CANARY_INSTRUCTION, CANARY_TOKEN, tag } from '@gtm-trust-kernel/adapters/model/trust.js';
import type { TrustedText } from '@gtm-trust-kernel/adapters/model/trust.js';
import type { Account, Activity, Contact, Note, Opportunity } from '@gtm-trust-kernel/adapters/model/canonical.js';
import type { SecondSourceAccount, SecondSourceContact } from '@gtm-trust-kernel/adapters/types.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildCoverageSample, hydrateAccounts, hydrateActivities, hydrateContacts, hydrateNotes, hydrateStageHistory } from '../../src/coverageSample.js';
import type { CoverageSample } from '../../src/metrics/types.js';
import { runSample } from '../../src/sample.js';
import type { SampleConfig } from '../../src/sample.js';
import { buildReportData } from '../../src/report/buildReport.js';
import type { ReportData } from '../../src/report/buildReport.js';
import { renderComparisonHtml, renderReportHtml } from '../../src/report/render.js';
import { renderPlainReportHtml } from '../../src/report/plainReport.js';

// ---------------------------------------------------------------------------
// Canary vocabulary. Six flavors, cycled by index so every mutated field gets
// a distinct full value (traceable to its own record) while every flavor's
// distinctive fragment appears somewhere across the corpus.
// ---------------------------------------------------------------------------

const CANARY_TEMPLATES: readonly ((seed: string) => string)[] = [
  (seed) => `canary.leak.${seed}@redactiontest.invalid`,
  (seed) => `Canaryton, ${seed}`,
  (seed) => `sk_live_CANARY1234567890_${seed}`,
  (seed) => `"><script>window.__CANARY_XSS__=1;/*${seed}*/</script>`,
  (seed) => `+1 (202) 555-0199 x${seed}`,
  (seed) => `${CANARY_INSTRUCTION} [${seed}]`,
];

function canaryValue(seed: string, index: number): string {
  const template = CANARY_TEMPLATES[index % CANARY_TEMPLATES.length]!;
  return template(seed);
}

/** Lowercase, alnum-only. Survives HTML-escaping and formatting changes to the punctuation around a fragment. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const CANARY_FRAGMENTS = ['canaryton', 'redactiontest', 'canary1234', 'canaryxss', '5550199', normalize(CANARY_TOKEN)] as const;

function containsAnyCanary(haystack: string): boolean {
  const normalized = normalize(haystack);
  return CANARY_FRAGMENTS.some((f) => normalized.includes(f));
}

function assertNoCanary(haystack: string, surface: string): void {
  const normalized = normalize(haystack);
  for (const fragment of CANARY_FRAGMENTS) {
    expect(normalized, `${surface} leaked canary fragment "${fragment}"`).not.toContain(fragment);
  }
}

// ---------------------------------------------------------------------------
// Fixture construction: clone healthy's data (never mutated) and rebuild
// every text-bearing field via .map()/spread, never in-place assignment
// (every canonical/second-source field involved is `readonly`).
// ---------------------------------------------------------------------------

let canaryCounter = 0;

function canaryTag(original: TrustedText, seed: string): TrustedText {
  return tag(original.tier, canaryValue(seed, canaryCounter++), original.source);
}

function canaryNote(note: Note): Note {
  return { ...note, body: canaryTag(note.body, note.ref.id) };
}

function canaryActivity(activity: Activity): Activity {
  return {
    ...activity,
    subject: activity.subject ? canaryTag(activity.subject, `${activity.ref.id}:subject`) : activity.subject,
    body: activity.body ? canaryTag(activity.body, `${activity.ref.id}:body`) : activity.body,
  };
}

function canaryOpportunity(opportunity: Opportunity): Opportunity {
  return opportunity.nextStep ? { ...opportunity, nextStep: canaryTag(opportunity.nextStep, opportunity.ref.id) } : opportunity;
}

function canaryContact(contact: Contact): Contact {
  return {
    ...contact,
    name: canaryValue(`${contact.ref.id}:name`, canaryCounter++),
    email: contact.email ? canaryValue(`${contact.ref.id}:email`, canaryCounter++) : contact.email,
  };
}

function canaryAccount(account: Account): Account {
  return {
    ...account,
    name: canaryValue(`${account.ref.id}:name`, canaryCounter++),
    domain: account.domain ? canaryValue(`${account.ref.id}:domain`, canaryCounter++) : account.domain,
  };
}

function canarySecondSourceContact(contact: SecondSourceContact): SecondSourceContact {
  return contact.email ? { ...contact, email: canaryValue(`${contact.ref.id}:email`, canaryCounter++) } : contact;
}

function canarySecondSourceAccount(account: SecondSourceAccount): SecondSourceAccount {
  return account.domain ? { ...account, domain: canaryValue(`${account.ref.id}:domain`, canaryCounter++) } : account;
}

function buildCanaryOrg() {
  const base = MOCK_ORG_FIXTURES.healthy;
  const baseSecondSource = base.secondSource;
  if (!baseSecondSource) throw new Error('expected the healthy fixture to define a second source');

  // SecondSourceActivity (adapters/src/types.ts) has no text-bearing field
  // (ref/contactRef/accountRef/occurredAt/kind/createdAt/lastModifiedAt only)
  // — nothing to seed there, left unchanged.
  return {
    data: {
      ...base.data,
      notes: base.data.notes.map(canaryNote),
      activities: base.data.activities.map(canaryActivity),
      opportunities: base.data.opportunities.map(canaryOpportunity),
      contacts: base.data.contacts.map(canaryContact),
      accounts: base.data.accounts.map(canaryAccount),
    },
    capabilities: base.capabilities,
    asOf: base.asOf,
    secondSource: {
      capabilities: baseSecondSource.capabilities,
      data: {
        ...baseSecondSource.data,
        contacts: baseSecondSource.data.contacts.map(canarySecondSourceContact),
        accounts: baseSecondSource.data.accounts.map(canarySecondSourceAccount),
      },
    },
  };
}

// ---------------------------------------------------------------------------

describe('redaction canary: no canary fragment survives into any output surface', () => {
  let canaryOrg: ReturnType<typeof buildCanaryOrg>;
  let sample: CoverageSample;
  let reportData: ReportData;
  let tabularHtml: string;
  let tabularHtmlLive: string;
  let plainHtml: string;
  let comparisonHtml: string;
  let consoleOutput: string;

  beforeAll(async () => {
    canaryOrg = buildCanaryOrg();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // Manual replay of buildReportData's own hydration orchestration
      // (coverageSample.ts), so the positive control below can inspect
      // post-hydration CoverageSample fields directly, not just the input
      // fixture object.
      const hydrationAdapter = new MockAdapter('org-canary', canaryOrg.data, canaryOrg.capabilities);
      const sampleConfig: SampleConfig = {
        seed: 'redaction-canary',
        perStratumSampleSize: 20,
        maxRecordsToScan: 5000,
        pageSizeBulk: 2000,
        pageSizeStandard: 200,
        asOf: canaryOrg.asOf,
      };
      const sampleResult = await runSample(hydrationAdapter, sampleConfig, () => true);
      if ('cancelled' in sampleResult) throw new Error('unreachable: test always auto-confirms sampling');

      let s = buildCoverageSample(sampleResult, hydrationAdapter.capabilities());
      s = (await hydrateAccounts(s, hydrationAdapter)).sample;
      s = (await hydrateStageHistory(s, hydrationAdapter)).sample;
      s = (await hydrateNotes(s, hydrationAdapter)).sample;
      s = (await hydrateActivities(s, hydrationAdapter)).sample;
      s = (await hydrateContacts(s, hydrationAdapter)).sample;
      sample = s;

      // Separate adapter instances for the actual production pipeline —
      // fresh state, same canary data.
      const reportAdapter = new MockAdapter('org-canary', canaryOrg.data, canaryOrg.capabilities);
      const reportSecondSourceAdapter = new MockSecondSourceAdapter(canaryOrg.secondSource.data, canaryOrg.secondSource.capabilities);

      reportData = await buildReportData(reportAdapter, reportSecondSourceAdapter, {
        orgLabel: 'Canary Org',
        orgDescription: 'Redaction canary fixture — every text field seeded, none of it should reach any output surface.',
        asOf: canaryOrg.asOf,
      });

      tabularHtml = renderReportHtml(reportData);
      tabularHtmlLive = renderReportHtml(reportData, { mode: 'live' });
      plainHtml = renderPlainReportHtml(reportData);
      comparisonHtml = renderComparisonHtml([reportData]);
    } finally {
      consoleOutput = [...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
        .flat()
        .map((v) => (typeof v === 'string' ? v : JSON.stringify(v)))
        .join('\n');
      logSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  describe('positive control (proves the canaries actually reached the pipeline, not just the input fixture)', () => {
    it('the hydrated CoverageSample carries canary fragments in notes, activities, opportunity nextSteps, contacts, and accounts', () => {
      const noteTexts = [...sample.notesByOpportunity.values()].flat().map((n) => n.body.value);
      expect(noteTexts.length).toBeGreaterThan(0);
      expect(noteTexts.some(containsAnyCanary)).toBe(true);

      const activityTexts = [...sample.activitiesByOpportunity.values()]
        .flat()
        .flatMap((a) => [a.subject?.value, a.body?.value])
        .filter((v): v is string => Boolean(v));
      expect(activityTexts.some(containsAnyCanary)).toBe(true);

      const nextSteps = [...sample.openOpportunities, ...sample.closedOpportunities]
        .map((o) => o.nextStep?.value)
        .filter((v): v is string => Boolean(v));
      expect(nextSteps.some(containsAnyCanary)).toBe(true);

      const contactTexts = [...sample.contactsByRef.values()].flatMap((c) => [c.name, c.email]).filter((v): v is string => Boolean(v));
      expect(contactTexts.some(containsAnyCanary)).toBe(true);

      const accountTexts = [...sample.accountsByRef.values()].flatMap((a) => [a.name, a.domain]).filter((v): v is string => Boolean(v));
      expect(accountTexts.some(containsAnyCanary)).toBe(true);
    });

    it('the second-source adapter actually serves canary email/domain data (checked pre-hash — sampleSecondSource hashes on ingestion, so this is the only point raw second-source canary text is ever observable)', async () => {
      const adapter = new MockSecondSourceAdapter(canaryOrg.secondSource.data, canaryOrg.secondSource.capabilities);
      const contactsPage = await adapter.listContacts({ limit: 200 });
      const accountsPage = await adapter.listAccounts({ limit: 200 });

      expect(contactsPage.items.some((c) => c.email !== null && containsAnyCanary(c.email))).toBe(true);
      expect(accountsPage.items.some((a) => a.domain !== null && containsAnyCanary(a.domain))).toBe(true);
    });
  });

  describe('negative assertions (no shipped output surface may carry any canary fragment)', () => {
    it.each([
      ['--json (JSON.stringify(ReportData))', () => JSON.stringify(reportData)],
      ['tabular HTML (renderReportHtml, fixture mode)', () => tabularHtml],
      ['tabular HTML (renderReportHtml, {mode: "live"})', () => tabularHtmlLive],
      ['plain HTML (renderPlainReportHtml)', () => plainHtml],
      ['comparison HTML (renderComparisonHtml, the --all path)', () => comparisonHtml],
      ['console.log/warn/error output during buildReportData and every render call', () => consoleOutput],
    ] as const)('%s', (surface, getText) => {
      assertNoCanary(getText(), surface);
    });
  });
});
