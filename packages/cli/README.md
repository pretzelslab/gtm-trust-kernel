# gtm-trust-kernel

## What is this

A command-line tool that checks how healthy and trustworthy the data in a sales CRM is, and gives you a scored report. "Trust" here means: is the data complete, consistent and recent enough that you could safely let AI (or a forecast) rely on it? "Readiness" means: is this CRM in good enough shape to build on? Salesforce is supported today, and other CRMs can be added via adapters.

## Who it's for

- **Sales, RevOps and GTM leaders** who want a quick read on CRM data quality.
- **Developers** evaluating the trust kernel or wiring the check into their own workflow.

## Try it in 1 minute

Requires Node.js 22 or newer.

```bash
npx gtm-trust-kernel scan --demo
```

This runs against a bundled sample CRM, so it doesn't connect to any real CRM and needs no credentials. You'll see a sampling plan in the terminal, then an HTML report is written to `./out` in your current directory. Open `out/latest.html` in a browser to read it.

- `--json` prints the report data as JSON to stdout (the plan and progress go to stderr, so you can pipe it).
- `--narrative` adds an AI-written plain-English summary. It needs `ANTHROPIC_API_KEY` set, fails with an error if it isn't, and sends report data to Anthropic's API.

## Reference

CLI for the [GTM trust kernel](https://github.com/pretzelslab/gtm-trust-kernel)'s
readiness report — a scored CRM data-health diagnostic.

### Output files

Each run writes to `./out` in the current directory:

- `report-<timestamp>.html` — the full report, timestamped so runs don't overwrite each other.
- `report-<timestamp>-plain.html` — a plainer version of the same report.
- `latest.html` and `latest-plain.html` — always updated to the newest run.

The bundled `healthy` mock CRM org is used, so no CRM credentials or CRM network access are needed.

### Usage

```
gtm-trust-kernel scan --demo [--narrative] [--json]
gtm-trust-kernel --version
gtm-trust-kernel --help
```

Only `scan --demo` is supported right now. `--json` prints the underlying
report data as JSON to stdout only; the sampling plan and progress messages go
to stderr, so the output can be piped safely.

#### `--narrative`

Adds an LLM-generated plain-English summary to the report. This is opt-in
and requires an `ANTHROPIC_API_KEY` environment variable, and it sends report
data to Anthropic's API. The command fails loudly if the flag is passed without one set. Without `--narrative`,
no API key is needed at all.

```bash
ANTHROPIC_API_KEY=sk-ant-... npx gtm-trust-kernel scan --demo --narrative
```

### More

Part of the [gtm-trust-kernel](https://github.com/pretzelslab/gtm-trust-kernel)
monorepo — see that repo for the full readiness methodology and the
`@gtm-trust-kernel/adapters` library this CLI is built on.
