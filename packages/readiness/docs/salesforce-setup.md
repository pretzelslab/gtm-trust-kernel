# Salesforce setup for a first run

How to point the readiness report at a Salesforce org, for a first run
against a Developer Edition org you seed by hand. The report only reads
from Salesforce; the adapter has no write path (`writeGranularity: 'none'`).

Anything marked **unverified** is written from Salesforce's documentation
or from the adapter's code, and has not yet been checked against a live
org. The Developer Edition smoke run is where it gets checked (see
`STATUS.md`, "Live-org questions").

## 1. Get a Developer Edition org

1. Sign up at <https://developer.salesforce.com/signup>. It is free.
   **Unverified:** the signup flow, and whether a new org comes with any
   sample opportunities, change over time. The report reads whatever is
   there.
2. Note your org's My Domain URL (Setup, then My Domain), for example
   `https://yourname-dev-ed.develop.my.salesforce.com`. This is
   `SF_INSTANCE_URL`. The token request goes to this URL
   (`{SF_INSTANCE_URL}/services/oauth2/token`), so use the My Domain URL,
   not `login.salesforce.com`. **Unverified** on a live org.

A fresh Developer Edition org is single-currency, and the adapter doesn't
query `CurrencyIsoCode` for that reason.

## 2. Create the app the adapter signs in with

The adapter uses the **OAuth 2.0 client credentials flow**. It sends
`grant_type=client_credentials` with a client id and secret. There is no
browser login and no refresh token. **Unverified:** the exact Setup menu
names. Newer orgs may offer an "External Client App" instead of a classic
"Connected App"; either works if it supports the client credentials flow.

1. Setup, then App Manager, then New Connected App (or New External
   Client App).
2. Enable OAuth settings. Callback URL: any placeholder, for example
   `https://localhost/callback` (this flow never uses it).
3. OAuth scope: **Manage user data via APIs (`api`)**.
4. Enable the **Client Credentials Flow** and set its **Run As** user.
   Every query runs as that user, so the report sees only what that user
   can see (next section).
5. Save, then copy the consumer key (`SF_CLIENT_ID`) and consumer secret
   (`SF_CLIENT_SECRET`). Salesforce can take a few minutes before a new
   app accepts tokens.

## 3. What the Run As user needs

The report queries these objects, read-only:

| Object | Why |
|---|---|
| `Opportunity` | The population count (`SELECT COUNT()`) and the scan |
| `OpportunityContactRole` | Contact roles on each scanned deal (`contact_linkage_rate`) |
| `Account` | Account names and domains for sampled deals (`duplicate_account_rate`, `account_resolution_rate`) |
| `Note` | Legacy notes on sampled deals |
| `ContentDocumentLink`, `ContentNote` | Enhanced Notes linked to sampled deals, including the full text of long notes |
| `Task`, `Event` | Activities on sampled deals (read even when activity capture is off) |
| `OpportunityHistory` | Stage history (`stage_history_months`, `win_rate_dispersion`) |

`Contact` is only read when a second source is connected, which the
`--live` report doesn't do today.

Minimum, **unverified** on a live org:

- **API Enabled** on the user's profile or a permission set.
- **Read** on Account, Opportunity and Contact. Contact roles, legacy
  notes, activities and opportunity history follow access to the parent
  opportunity; Enhanced Notes follow file sharing on the linked record.
- **Record visibility decides coverage.** The scan only counts and reads
  the opportunities the Run As user can see. To assess the whole org,
  give that user **View All** on Opportunity (and Account), or use an
  admin user in a throwaway Developer Edition org. With narrower
  sharing the report describes only that user's slice.

### Enhanced Notes

Enhanced Notes (the Notes related list in Lightning) are read through the
`ContentNote` object. Before any reads, the report checks once whether the
Run As user can query it.

1. Setup, then Notes Settings, then **Enable Notes**.
2. Check that the Run As user's profile or a permission set gives read
   access to Notes. On the 2026-09-30 smoke run, `ContentNote` was still
   not queryable after Notes were enabled (the describe answered 404
   `NOT_FOUND`), so check this even when Notes are on.

If Enhanced Notes are linked to sampled deals but `ContentNote` can't be
read, the note metrics show as **Not measured**, with a hint naming these
two steps; the run doesn't fail. With no Enhanced Notes linked, nothing is
missing and the note metrics are scored as usual.

## 4. Settings (`.env`)

Copy `.env.example` at the repo root to `.env` and fill it in. The report
reads `.env` from the repo root, and a variable already set in your shell
wins over the file.

| Variable | Required | Meaning | Default |
|---|---|---|---|
| `SF_CLIENT_ID` | Yes | Consumer key of the app in step 2 | None |
| `SF_CLIENT_SECRET` | Yes | Consumer secret of the app in step 2 | None |
| `SF_INSTANCE_URL` | Yes | Your My Domain URL; a trailing `/` is removed | None |
| `SF_API_VERSION` | No | REST API version, with the `v` | `v62.0` |
| `SF_TOKEN_CACHE_PATH` | No | Where the access token is cached between runs | `.cache/salesforce-token.json` inside the adapters package |
| `SF_ACTIVITY_CAPTURE` | No | `auto` or `manual`: how your org captures activity (below) | Unset, treated as `manual` |
| `SF_NOTE_FULLTEXT_FETCH_LIMIT` | No | Most Enhanced Note bodies fetched in full per run, for notes whose preview is cut off. `0` never fetches | `200` |
| `SF_STAGE_MAP_PATH` | No | Path to a JSON file mapping your stage labels to the tool's stages (below) | Unset: only Salesforce's default stage labels are mapped |

A missing required variable, a bad `SF_ACTIVITY_CAPTURE` or
`SF_NOTE_FULLTEXT_FETCH_LIMIT`, or a bad stage map file stops the run with
an error naming the problem.

The token cache holds a live access token. It is git-ignored; delete it to
force a fresh sign-in.

### `SF_ACTIVITY_CAPTURE`

Salesforce doesn't say whether Tasks and Events are written automatically
(by email and calendar sync) or logged by hand, so you declare it:

- `auto`: your org syncs email and calendar activity. Activity metrics
  (`activity_capture_rate`, `stage_activity_contradiction_rate`) are scored.
- `manual`, or unset: a deal with no activity may just mean nobody logged
  it, so those metrics show as **Not measured**, and the plain-English
  report suggests `SF_ACTIVITY_CAPTURE=auto` if that fits.

For a hand-seeded Developer Edition org, leave it unset (activity is
manual). Set `auto` to see the scored path.

### `SF_STAGE_MAP_PATH`

The tool grades against seven stages: `prospecting`, `discovery`,
`evaluation`, `proposal`, `negotiation`, `closed_won`, `closed_lost`.
Salesforce's default Sales Process labels are already mapped:

| Salesforce label | Tool stage |
|---|---|
| Prospecting | prospecting |
| Qualification, Needs Analysis | discovery |
| Value Proposition, Id. Decision Makers, Perception Analysis | evaluation |
| Proposal/Price Quote | proposal |
| Negotiation/Review | negotiation |
| Closed Won | closed_won |
| Closed Lost | closed_lost |

A custom label must be mapped in a JSON file, spelled exactly as Salesforce
stores `StageName`. Your entries are merged over the defaults:

```json
{
  "Technical Win": "evaluation",
  "Security Review": "negotiation",
  "Signed": "closed_won"
}
```

Then set `SF_STAGE_MAP_PATH=./stage-map.json` (relative paths resolve from
the directory you run the command in; an absolute path avoids surprises).

- A label that isn't mapped is reported as **unmapped**: it counts against
  `stage_mapping_coverage`, and `win_rate_dispersion` skips its history
  rows. When the scan finds one, the report shows a single notice
  suggesting a stage map. Stage labels never appear in the report.
- A mapping that contradicts Salesforce's own closed/won flags (for
  example an open deal mapped to `closed_won`) counts as unmapped, and the
  flags decide the stage.

## 5. Seed the org for a smoke run

Enough data to exercise every read path. Five opportunities is plenty;
the report will still call the sample small (below).

- [ ] **3 to 5 opportunities across stages**, for example Prospecting,
      Qualification and Proposal/Price Quote, each with an Account, Amount,
      Close Date and Next Step filled in.
- [ ] **1 closed opportunity** (Closed Won or Closed Lost) with a Close
      Date in the last 12 months. Older closed deals are outside the
      sample population.
- [ ] **1 contact role**: add a Contact to one opportunity's Contact Roles.
- [ ] **1 Enhanced Note** on an opportunity (the Notes related list in
      Lightning). Make one longer than 255 characters to exercise the
      full-text fetch (**unverified:** the 255-character preview cap).
- [ ] **1 legacy Note** on an opportunity. **Unverified:** Lightning may
      only offer Enhanced Notes; if so, create it in Salesforce Classic or
      insert a `Note` record through the API.
- [ ] **1 Task** related to an opportunity (Log a Call, or New Task with
      Related To set to the opportunity).
- [ ] **1 Event** related to an opportunity (New Event on its Activity tab).
- [ ] **1 unmapped custom stage**: add a Stage picklist value (Setup,
      Object Manager, Opportunity, Fields & Relationships, Stage), for
      example `Technical Win`. Make sure the opportunity's Sales Process
      offers it (**unverified** for a fresh Developer Edition org), then move
      one opportunity to it. Run once without a stage map (expect the stage-map
      notice), then again with it mapped (expect no notice).
- [ ] Change one opportunity's stage at least once, so `OpportunityHistory`
      has rows.

## 6. Run it

From `packages/readiness` (no build step needed; the report reads the
adapter source):

```bash
npm run report -- --live                            # HTML reports
npm run report -- --live --json                     # also write the report data as JSON
npm run report -- --live --quick                    # stop scanning once every stage's sample is full
npm run report -- --live --hydrate-per-stratum 5    # detailed checks on up to 5 deals per stage (default 20)
```

Output goes to `packages/readiness/out/`: `live-latest.html` (tables),
`live-latest-plain.html` (plain English), plus timestamped copies and the
`.json` file when `--json` is set. `--narrative` adds an AI-written summary
and needs `ANTHROPIC_API_KEY`.

What a run does:

- Counts the eligible deals (every open one, plus closed ones in the last
  12 months) and scans up to 5,000 of them, newest created first. The
  list-field metrics run over the whole scan.
- Draws up to 20 deals per stage (7 stages) from the scan, at random with a
  fixed seed, for the detailed checks: notes, activities, stage history,
  accounts.
- The report states both sizes and the seed. If eligible deals went
  unread (the 5,000 budget, or `--quick`), it says so.

Estimated API calls at 5,000 eligible deals (**unverified** on a live
org): about 52 for the scan, and about 565 for the detailed checks at 20
per stage, plus up to 200 note full-text fetches. A Developer Edition org's
daily API limit is assumed at 15,000 (**unverified**; the adapter doesn't
read the org's real limits). On a five-deal seeded org, expect a few dozen
calls.

## 7. What to expect

### An empty org

Before seeding, the report is almost entirely **Blocked**, and that is
correct: Blocked means the data is missing, and an empty org has none.
This is what the adapter produces with no records at all (checked through
the adapter's in-memory fake Salesforce API, not a live org):

- Plain report: "None of the 8 AI-assisted sales tools are ready yet."
  Every use case is under "Not ready yet".
- Capabilities table: every capability **Blocked**.
- Metrics table: most rows **N/A** with no value (no deals to measure).
  `closed_deal_count_12m` is 0 and `stage_history_months` is 0, both
  Blocked. `owner_history_enabled` is No, Blocked (the adapter can't
  assume owner field history). `close_date_history_enabled` is Yes,
  Viable (Salesforce always records it).
- Activity metrics are **Not measured** unless `SF_ACTIVITY_CAPTURE=auto`,
  and next-step history is always Not measured on Salesforce. Blocked
  outranks Not measured, so no use case shows as "Can't tell yet".
- Cross-system (D5) metrics are Blocked: no second source is connected.
- "Scanned 0 of 0 eligible deals; detailed checks on 0 sampled deals".
  No unread notice and no stage-map notice.

### A hand-seeded org

Still mostly Blocked or low-confidence, which is expected. Five deals is
below the 30-record confidence floor, and one closed deal is far below
`closed_deal_count_12m`'s 20 (Blocked) / 40 (Viable) thresholds. The smoke
run checks that every read path returns data and that the counts match
what you seeded, not that the org is ready:

- Eligible deals equal your open deals plus closed deals in the last 12
  months, and all were scanned.
- `contact_linkage_rate`, `note_coverage_rate` and the note metrics show
  your contact role and notes.
- The stage-map notice appears with the unmapped stage and disappears once
  it is mapped.
- With `SF_ACTIVITY_CAPTURE=auto`, activity metrics get values from your
  Task and Event.
