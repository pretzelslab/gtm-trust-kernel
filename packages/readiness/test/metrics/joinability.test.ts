import { describe, expect, it } from 'vitest';
import {
  accountResolutionRate,
  activityAttributionRate,
  contactIdentityResolutionRate,
  temporalAnomalyRate,
} from '../../src/metrics/joinability.js';
import {
  ASOF,
  config,
  coverageSample,
  crmAccount,
  crmActivity,
  crmContact,
  opportunity,
  resolution,
  secondSourceActivity,
  secondSourceCapabilities,
  secondSourceSample,
  ssRef,
} from '../fixtures/joinability.js';

describe('contactIdentityResolutionRate', () => {
  it('is not_instrumented when no second source is connected', () => {
    const result = contactIdentityResolutionRate(coverageSample({}), config());
    expect(result.status).toBe('not_instrumented');
    expect(result.note).toBe('no second source connected');
  });

  it('is not_instrumented when the second source has no contact data', () => {
    const sample = coverageSample({ contactsByRef: new Map([['con-1', crmContact('con-1', 'a@example.com')]]) });
    const result = contactIdentityResolutionRate(sample, config(resolution({ capabilities: secondSourceCapabilities({ hasContacts: false }) })));
    expect(result.status).toBe('not_instrumented');
  });

  it('is not_instrumented when contactsHydrated is false', () => {
    const sample = coverageSample({ contactsHydrated: false });
    const result = contactIdentityResolutionRate(sample, config(resolution()));
    expect(result.status).toBe('not_instrumented');
    expect(result.note).toContain('contactsHydrated');
  });

  it('is not_applicable when no sampled contact has an email', () => {
    const sample = coverageSample({ contactsByRef: new Map([['con-1', crmContact('con-1')]]) });
    const result = contactIdentityResolutionRate(sample, config(resolution()));
    expect(result.status).toBe('not_applicable');
  });

  it('computes the resolved share: 1 of 2 emailed contacts matches', () => {
    const sample = coverageSample({
      contactsByRef: new Map([
        ['con-1', crmContact('con-1', 'a@example.com')],
        ['con-2', crmContact('con-2', 'b@example.com')],
      ]),
    });
    const res = resolution({ contactMatches: new Map([['con-1', [ssRef('contact', 'ss-1')]]]) });
    const result = contactIdentityResolutionRate(sample, config(res));
    expect(result.status).toBe('ok');
    expect(result.value).toBe(0.5);
    expect(result.sampleSize).toBe(2);
  });

  it('sets floor: true when the second source contact sample was truncated', () => {
    const sample = coverageSample({ contactsByRef: new Map([['con-1', crmContact('con-1', 'a@example.com')]]) });
    const res = resolution({ secondSourceSample: secondSourceSample({ contactsTruncated: true }) });
    const result = contactIdentityResolutionRate(sample, config(res));
    expect(result.status).toBe('ok');
    expect(result.floor).toBe(true);
  });
});

describe('accountResolutionRate', () => {
  it('is not_instrumented when no second source is connected', () => {
    const result = accountResolutionRate(coverageSample({}), config());
    expect(result.status).toBe('not_instrumented');
  });

  it('is not_instrumented when the second source has no account data', () => {
    const sample = coverageSample({ accountsByRef: new Map([['acc-1', crmAccount('acc-1', 'example.com')]]) });
    const result = accountResolutionRate(sample, config(resolution({ capabilities: secondSourceCapabilities({ hasAccounts: false }) })));
    expect(result.status).toBe('not_instrumented');
  });

  it('is not_instrumented when accountsHydrated is false', () => {
    const result = accountResolutionRate(coverageSample({ accountsHydrated: false }), config(resolution()));
    expect(result.status).toBe('not_instrumented');
  });

  it('computes the resolved share using normalized domains', () => {
    const sample = coverageSample({
      accountsByRef: new Map([
        ['acc-1', crmAccount('acc-1', 'https://Example.com/')],
        ['acc-2', crmAccount('acc-2', 'other.com')],
      ]),
    });
    const res = resolution({ accountMatches: new Map([['acc-1', [ssRef('account', 'ss-acc-1')]]]) });
    const result = accountResolutionRate(sample, config(res));
    expect(result.status).toBe('ok');
    expect(result.value).toBe(0.5);
  });

  it('sets floor: true when the second source account sample was truncated', () => {
    const sample = coverageSample({ accountsByRef: new Map([['acc-1', crmAccount('acc-1', 'example.com')]]) });
    const res = resolution({ secondSourceSample: secondSourceSample({ accountsTruncated: true }) });
    const result = accountResolutionRate(sample, config(res));
    expect(result.floor).toBe(true);
  });
});

describe('activityAttributionRate', () => {
  it('is not_instrumented when no second source is connected', () => {
    expect(activityAttributionRate(coverageSample({}), config()).status).toBe('not_instrumented');
  });

  it('is not_instrumented when the second source has no activity data', () => {
    const res = resolution({ capabilities: secondSourceCapabilities({ hasActivities: false }) });
    expect(activityAttributionRate(coverageSample({}), config(res)).status).toBe('not_instrumented');
  });

  it('is not_instrumented when neither contact nor account data is available, even though activities are — a low rate must never stand in for a missing capability', () => {
    const res = resolution({
      capabilities: secondSourceCapabilities({ hasActivities: true, hasContacts: false, hasAccounts: false }),
      secondSourceSample: secondSourceSample({ activities: [secondSourceActivity({ id: 'ss-act-1', occurredAt: ASOF })] }),
    });
    const result = activityAttributionRate(coverageSample({}), config(res));
    expect(result.status).toBe('not_instrumented');
    expect(result.note).toBe('no contact or account data in second source to attribute through');
  });

  it('is not_applicable when there are no sampled second-source activities', () => {
    expect(activityAttributionRate(coverageSample({}), config(resolution())).status).toBe('not_applicable');
  });

  it('attributes an activity via contactRef when it falls inside the matched opportunity\'s open window', () => {
    const opp = opportunity({ id: 'opp-1', accountId: 'acc-1', contactIds: ['con-1'], createdAt: '2026-01-01T00:00:00.000Z' });
    const sample = coverageSample({ openOpportunities: [opp] });
    const res = resolution({
      contactMatches: new Map([['con-1', [ssRef('contact', 'ss-con-1')]]]),
      secondSourceSample: secondSourceSample({
        activities: [secondSourceActivity({ id: 'ss-act-1', contactId: 'ss-con-1', occurredAt: '2026-03-01T00:00:00.000Z' })],
      }),
    });
    const result = activityAttributionRate(sample, config(res));
    expect(result.status).toBe('ok');
    expect(result.value).toBe(1);
  });

  it('does not attribute an activity dated before the matched opportunity was even created', () => {
    const opp = opportunity({ id: 'opp-1', accountId: 'acc-1', contactIds: ['con-1'], createdAt: '2026-05-01T00:00:00.000Z' });
    const sample = coverageSample({ openOpportunities: [opp] });
    const res = resolution({
      contactMatches: new Map([['con-1', [ssRef('contact', 'ss-con-1')]]]),
      secondSourceSample: secondSourceSample({
        activities: [secondSourceActivity({ id: 'ss-act-1', contactId: 'ss-con-1', occurredAt: '2026-01-01T00:00:00.000Z' })],
      }),
    });
    const result = activityAttributionRate(sample, config(res));
    expect(result.value).toBe(0);
  });

  it('attributes via accountRef when no contact match exists', () => {
    const opp = opportunity({ id: 'opp-1', accountId: 'acc-1', createdAt: '2026-01-01T00:00:00.000Z' });
    const sample = coverageSample({ openOpportunities: [opp] });
    const res = resolution({
      accountMatches: new Map([['acc-1', [ssRef('account', 'ss-acc-1')]]]),
      secondSourceSample: secondSourceSample({
        activities: [secondSourceActivity({ id: 'ss-act-1', accountId: 'ss-acc-1', occurredAt: '2026-03-01T00:00:00.000Z' })],
      }),
    });
    expect(activityAttributionRate(sample, config(res)).value).toBe(1);
  });

  it('sets floor: true when any of activities/contacts/accounts were truncated', () => {
    const res = resolution({
      secondSourceSample: secondSourceSample({
        activities: [secondSourceActivity({ id: 'ss-act-1', occurredAt: ASOF })],
        accountsTruncated: true,
      }),
    });
    const result = activityAttributionRate(coverageSample({}), config(res));
    expect(result.status).toBe('ok');
    expect(result.floor).toBe(true);
  });
});

describe('temporalAnomalyRate', () => {
  it('is not_instrumented when no second source is connected', () => {
    expect(temporalAnomalyRate(coverageSample({}), config()).status).toBe('not_instrumented');
  });

  it('is not_instrumented when the second source has no activity data', () => {
    const res = resolution({ capabilities: secondSourceCapabilities({ hasActivities: false }) });
    expect(temporalAnomalyRate(coverageSample({}), config(res)).status).toBe('not_instrumented');
  });

  it('is not_applicable when there are no records of any kind', () => {
    expect(temporalAnomalyRate(coverageSample({}), config(resolution())).status).toBe('not_applicable');
  });

  it('flags a CRM opportunity whose createdAt is after its modifiedAt', () => {
    const opp = { ...opportunity({ id: 'opp-1', accountId: 'acc-1', createdAt: '2026-03-01T00:00:00.000Z' }), modifiedAt: '2026-01-01T00:00:00.000Z' };
    const sample = coverageSample({ openOpportunities: [opp] });
    const result = temporalAnomalyRate(sample, config(resolution()));
    expect(result.status).toBe('ok');
    expect(result.value).toBe(1);
  });

  it('does NOT flag an open opportunity with a future close date — a forecasted close date is expected, not an anomaly', () => {
    const opp = opportunity({ id: 'opp-1', accountId: 'acc-1', createdAt: '2026-01-01T00:00:00.000Z', closeDate: '2026-12-01T00:00:00.000Z' });
    const sample = coverageSample({ openOpportunities: [opp] });
    const result = temporalAnomalyRate(sample, config(resolution()));
    expect(result.value).toBe(0);
  });

  it('flags an opportunity created more than 24h in the future relative to asOf', () => {
    const opp = opportunity({ id: 'opp-1', accountId: 'acc-1', createdAt: '2026-07-01T00:00:00.000Z' });
    const sample = coverageSample({ openOpportunities: [opp] });
    expect(temporalAnomalyRate(sample, config(resolution())).value).toBe(1);
  });

  it('flags a CRM activity dated after its closed opportunity\'s close date', () => {
    const opp = opportunity({ id: 'opp-1', accountId: 'acc-1', createdAt: '2026-01-01T00:00:00.000Z', closeDate: '2026-02-01T00:00:00.000Z', isClosed: true });
    const activity = crmActivity('act-1', 'opp-1', '2026-03-01T00:00:00.000Z'); // after closeDate
    const sample = coverageSample({
      closedOpportunities: [opp],
      activitiesByOpportunity: new Map([['opp-1', [activity]]]),
    });
    const result = temporalAnomalyRate(sample, config(resolution()));
    expect(result.status).toBe('ok');
    expect(result.sampleSize).toBe(2); // 1 opportunity + 1 activity
    expect(result.value).toBe(0.5); // opportunity itself is clean, the activity is anomalous
  });

  it('flags a second-source activity whose createdAt is after its lastModifiedAt', () => {
    const res = resolution({
      secondSourceSample: secondSourceSample({
        activities: [secondSourceActivity({ id: 'ss-act-1', occurredAt: ASOF, createdAt: '2026-03-01T00:00:00.000Z', lastModifiedAt: '2026-01-01T00:00:00.000Z' })],
      }),
    });
    const result = temporalAnomalyRate(coverageSample({}), config(res));
    expect(result.value).toBe(1);
  });

  it('flags a second-source activity dated after its attributed opportunity\'s close date', () => {
    const opp = opportunity({ id: 'opp-1', accountId: 'acc-1', contactIds: ['con-1'], createdAt: '2026-01-01T00:00:00.000Z', closeDate: '2026-02-01T00:00:00.000Z', isClosed: true });
    const sample = coverageSample({ closedOpportunities: [opp] });
    const res = resolution({
      contactMatches: new Map([['con-1', [ssRef('contact', 'ss-con-1')]]]),
      secondSourceSample: secondSourceSample({
        activities: [secondSourceActivity({ id: 'ss-act-1', contactId: 'ss-con-1', occurredAt: '2026-03-01T00:00:00.000Z' })],
      }),
    });
    const result = temporalAnomalyRate(sample, config(res));
    expect(result.value).toBe(0.5); // opportunity clean, activity anomalous
  });

  it('sets floor: true when the second-source activity sample was truncated', () => {
    const res = resolution({ secondSourceSample: secondSourceSample({ activitiesTruncated: true, activities: [secondSourceActivity({ id: 'ss-act-1', occurredAt: ASOF })] }) });
    const result = temporalAnomalyRate(coverageSample({}), config(res));
    expect(result.status).toBe('ok');
    expect(result.floor).toBe(true);
  });
});
