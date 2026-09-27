/**
 * Shared page shell (HTML escaping, theme CSS, page wrapper, banner) used by
 * both render.ts (the tabular report) and plainReport.ts (the plain-English
 * report) — kept in one place so the two can never render different banner
 * wording for the same run.
 */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const STYLE = `
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #1a1a1a; --muted: #6b7280; --border: #e2e2e2; --card-bg: #f9f9fb;
    --viable-bg: #d9f2e3; --viable-fg: #1a7f37;
    --degraded-bg: #fdecc8; --degraded-fg: #8a5a00;
    --blocked-bg: #fbeae9; --blocked-fg: #b42318;
    --na-bg: #f0f0f2; --na-fg: #6b7280;
    --ninstr-bg: #eaf1fb; --ninstr-fg: #3b5b82;
    --deferred-bg: #f1edf9; --deferred-fg: #5b4b8a;
    --nimpl-bg: #ececec; --nimpl-fg: #767676;
    --floor-bg: #fff3cd; --floor-fg: #8a6d00;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #14161a; --fg: #e7e7ea; --muted: #9aa0a6; --border: #2b2e33; --card-bg: #1c1f24; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--fg); font: 14px/1.5 -apple-system, Segoe UI, Helvetica, Arial, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 10px; }
  .banner { background: #b42318; color: #fff; font-weight: 700; padding: 10px 14px; border-radius: 6px; margin-bottom: 18px; letter-spacing: 0.02em; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
  .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; margin: 12px 0 20px; }
  .card { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .card .n { font-size: 20px; font-weight: 700; }
  .card .l { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--border); vertical-align: top; font-size: 13px; }
  th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: 0.03em; }
  tr.dim-header td { background: var(--card-bg); font-weight: 700; padding-top: 14px; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .status-viable { background: var(--viable-bg); color: var(--viable-fg); }
  .status-degraded { background: var(--degraded-bg); color: var(--degraded-fg); }
  .status-blocked { background: var(--blocked-bg); color: var(--blocked-fg); }
  .status-not_applicable { background: var(--na-bg); color: var(--na-fg); }
  .status-not_instrumented { background: var(--ninstr-bg); color: var(--ninstr-fg); }
  .status-deferred { background: var(--deferred-bg); color: var(--deferred-fg); border: 1px dashed var(--deferred-fg); }
  .status-not_implemented { background: var(--nimpl-bg); color: var(--nimpl-fg); border: 1px dashed var(--nimpl-fg); }
  .note { color: var(--muted); font-size: 12px; }
  .gates { font-size: 12px; color: var(--muted); }
  .thresh { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .lowconf { font-size: 11px; color: var(--degraded-fg); }
  .floor-badge { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.03em; background: var(--floor-bg); color: var(--floor-fg); border: 1px solid var(--floor-fg); cursor: help; }
  .banner-live { background: var(--card-bg); color: var(--fg); border: 1px solid var(--border); font-weight: 600; padding: 10px 14px; border-radius: 6px; margin-bottom: 18px; letter-spacing: 0.02em; }
  .plain-summary { background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; margin-bottom: 18px; }
  .plain-summary summary { cursor: pointer; font-weight: 600; }
  .plain-summary p { margin: 10px 0 0; }
  .plain-summary ul { margin: 10px 0 0; }
  .narrative-fallback-notice { background: var(--ninstr-bg); color: var(--ninstr-fg); border: 1px solid var(--ninstr-fg); border-radius: 6px; padding: 8px 12px; margin-top: 10px; font-size: 12px; }
  ul { padding-left: 20px; }
  ul li { margin-bottom: 10px; }
`;

export function pageShell(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/**
 * Single source of truth for both single-org report banners (render.ts's
 * renderReportHtml, plainReport.ts's renderPlainReportHtml) so they can
 * never disagree about whether a given run's data came from a live CRM.
 * Not used by renderComparisonHtml (--all), which is fixture-only and
 * keeps its own banner markup unchanged.
 */
export function renderBanner(mode: 'fixture' | 'live', orgLabel: string): string {
  if (mode === 'live') {
    return `<div class="banner-live">LIVE DATA · read-only</div>`;
  }
  return `<div class="banner">MOCK DATA — fixture: ${escapeHtml(orgLabel)}. No real CRM was contacted; nothing leaves this machine.</div>`;
}
