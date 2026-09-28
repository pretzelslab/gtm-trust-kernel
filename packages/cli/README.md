# gtm-trust-kernel

CLI for the [GTM trust kernel](https://github.com/pretzelslab/gtm-trust-kernel)'s
readiness report — a scored CRM data-health diagnostic.

## Try it

```bash
npx gtm-trust-kernel scan --demo
```

Runs the readiness assessment against a bundled `healthy` mock CRM org (no
CRM credentials, no network access) and writes an HTML report to `./out` in
the current directory.

## Usage

```
gtm-trust-kernel scan --demo [--narrative] [--json]
gtm-trust-kernel --version
gtm-trust-kernel --help
```

Only `scan --demo` is supported right now. `--json` additionally writes the
underlying report data as JSON alongside the HTML.

### `--narrative`

Adds an LLM-generated plain-English summary to the report. This is opt-in
and requires an `ANTHROPIC_API_KEY` environment variable — the command
fails loudly if the flag is passed without one set. Without `--narrative`,
no API key is needed at all.

```bash
ANTHROPIC_API_KEY=sk-ant-... npx gtm-trust-kernel scan --demo --narrative
```

## More

Part of the [gtm-trust-kernel](https://github.com/pretzelslab/gtm-trust-kernel)
monorepo — see that repo for the full readiness methodology and the
`@gtm-trust-kernel/adapters` library this CLI is built on.
