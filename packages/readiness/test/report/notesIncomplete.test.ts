import { describe, expect, it } from 'vitest';
import { MockAdapter } from '@gtm-trust-kernel/adapters/mock.js';
import type { AdapterCapabilities } from '@gtm-trust-kernel/adapters/types.js';
import { MOCK_ORG_FIXTURES } from '../../src/fixtures/mockOrgs.js';
import { buildReportData, gateVerdictOf, type ReportData } from '../../src/report/buildReport.js';

/**
 * Notes the adapter can't fully read (capabilities.notesComplete false,
 * e.g. Salesforce Enhanced Notes when ContentNote isn't queryable): every
 * metric that reads notes is not measured, with the adapter's hint, rather
 * than scored on a partial set of notes.
 */
const NOTE_METRICS = [
  'note_coverage_rate',
  'substantive_note_rate',
  'median_note_length_chars',
  'outcome_evidence_retention_rate',
  'pii_density',
  'untrusted_text_ratio',
] as const;

const HINT = 'Enable Notes and give the Run As user access to them.';

async function buildHealthy(caps: Partial<AdapterCapabilities>, adapterFactory = (a: MockAdapter) => a): Promise<ReportData> {
  const fixture = MOCK_ORG_FIXTURES.healthy;
  const adapter = adapterFactory(new MockAdapter(fixture.orgId, fixture.data, { ...fixture.capabilities, ...caps }));
  return buildReportData(adapter, undefined, { orgLabel: fixture.label, orgDescription: fixture.description, asOf: fixture.asOf });
}

describe('notes the adapter cannot fully read', () => {
  it('marks every note-reading metric not measured, with the setting hint', async () => {
    const data = await buildHealthy({ notesComplete: false, settingHints: { notesComplete: HINT } });
    for (const metric of NOTE_METRICS) {
      const row = data.metrics.find((m) => m.metric === metric)!;
      expect(row.status, metric).toBe('not_instrumented');
      expect(gateVerdictOf(row), metric).toBe('not_measured');
      expect(row.fixHint, metric).toBe(HINT);
    }
  });

  it('leaves metrics that read no notes alone', async () => {
    const data = await buildHealthy({ notesComplete: false, settingHints: { notesComplete: HINT } });
    for (const metric of ['close_date_fill_rate', 'contact_linkage_rate', 'stage_history_months']) {
      expect(data.metrics.find((m) => m.metric === metric)!.status, metric).toBe('ok');
    }
  });

  it('scores the note metrics as before when notes are complete or the adapter says nothing', async () => {
    for (const caps of [{ notesComplete: true }, {}]) {
      const data = await buildHealthy(caps);
      for (const metric of NOTE_METRICS) {
        expect(data.metrics.find((m) => m.metric === metric)!.status, metric).not.toBe('not_instrumented');
      }
    }
  });

  it("calls the adapter's probe once, before reading anything", async () => {
    const calls: string[] = [];
    await buildHealthy({}, (a) => {
      const probed = Object.assign(a, {
        probe: async () => {
          calls.push('probe');
        },
      });
      const list = probed.countOpportunitiesForSample.bind(probed);
      probed.countOpportunitiesForSample = async (...args: Parameters<typeof list>) => {
        calls.push('count');
        return list(...args);
      };
      return probed;
    });
    expect(calls[0]).toBe('probe');
    expect(calls.filter((c) => c === 'probe')).toHaveLength(1);
  });
});
