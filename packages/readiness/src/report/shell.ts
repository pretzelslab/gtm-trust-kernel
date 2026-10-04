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
    --dv-pass: #1a7f37; --dv-pass-bg: #dcf3e4; --dv-pass-fill: #2da44e;
    --dv-weak: #8a5a00; --dv-weak-bg: #fdf0cc; --dv-weak-fill: #d4a72c;
    --dv-fail: #b42318; --dv-fail-bg: #fbe4e2; --dv-fail-fill: #cf222e;
    --dv-unknown: #3b5b82; --dv-unknown-bg: #e6ecf4;
    --dv-none: #6b7280; --dv-none-bg: #f3f4f6;
    --dv-track: #e8e9ee; --dv-mark: #1a1a1a; --dv-panel: #ffffff;
    --accent: #2457c5; --accent-tint: #e7eefc; --band: #f4f5f8;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a; --fg: #e7e7ea; --muted: #9aa0a6; --border: #2b2e33; --card-bg: #1c1f24;
      --dv-pass: #56d364; --dv-pass-bg: #12301d; --dv-pass-fill: #2ea043;
      --dv-weak: #e3b341; --dv-weak-bg: #33280b; --dv-weak-fill: #bb8009;
      --dv-fail: #ff7b72; --dv-fail-bg: #3d1514; --dv-fail-fill: #da3633;
      --dv-unknown: #9db7da; --dv-unknown-bg: #1d2633;
      --dv-none: #9aa0a6; --dv-none-bg: #22252a;
      --dv-track: #2e3238; --dv-mark: #e7e7ea; --dv-panel: #181b20;
      --accent: #7aa7ff; --accent-tint: #1b2740; --band: #1a1d23;
    }
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
  .page { max-width: 1100px; margin: 0 auto; }
  .table-wrap { overflow-x: auto; margin-bottom: 18px; }
  .table-wrap table { margin-bottom: 0; }

  /* Jump bar and section bands. Sticky only on wide screens; :target outlines the section a link landed on. */
  .jump { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 0; margin: 12px 0 4px; background: var(--bg); }
  .jump a { color: var(--fg); text-decoration: none; font-size: 13px; font-weight: 600; padding: 4px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--band); }
  .jump a:hover, .jump a:focus-visible { border-color: var(--accent); color: var(--accent); }
  .jump a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .dv-part, .details-band { scroll-margin-top: 64px; }
  .dv-part { background: var(--dv-panel); border: 1px solid var(--border); border-radius: 12px; padding: 0 18px 18px; margin: 0 0 16px; }
  .dv-part-head { margin: 0 -18px 16px; padding: 12px 18px; background: var(--band); border-bottom: 1px solid var(--border); border-radius: 11px 11px 0 0; }
  .dv-lede, .details-lede { margin: 2px 0 0; font-size: 13px; color: var(--muted); }
  .details-band { margin-top: 32px; padding-top: 4px; border-top: 2px solid var(--border); border-radius: 0; }
  .details-head { padding: 12px 0 4px; }
  .details-head h2 { font-size: 18px; margin: 0; }
  .dv-part:target, .details-band:target { outline: 2px solid var(--accent); outline-offset: 2px; }
  .dv-part:target .dv-part-head, .details-band:target .details-head { background: var(--accent-tint); }
  .details-band:target .details-head { padding-left: 12px; padding-right: 12px; }
  @media (min-width: 720px) {
    .jump { position: sticky; top: 0; z-index: 5; border-bottom: 1px solid var(--border); }
  }

  /* Decision view (decisionView/render.ts). Every coloured mark also has a symbol or a word. */
  .dv { margin: 18px 0 28px; }
  .dv .dv-title { margin-bottom: 12px; }
  .dv-defs { position: absolute; width: 0; height: 0; overflow: hidden; }
  .dv-title { font-size: 18px; margin: 0 0 4px; }
  .dv h3 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--fg); margin: 0; }
  .dv-panel { background: var(--dv-panel); border: 1px solid var(--border); border-radius: 10px; padding: 6px 16px; }
  .dv-muted { color: var(--muted); }
  .dv-note { color: var(--muted); font-size: 12px; margin: -4px 0 8px; }
  .dv-tag { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .dv-s-pass { background: var(--dv-pass-bg); color: var(--dv-pass); }
  .dv-s-weak { background: var(--dv-weak-bg); color: var(--dv-weak); }
  .dv-s-failing { background: var(--dv-fail-bg); color: var(--dv-fail); }
  .dv-s-cant_tell { background: var(--dv-unknown-bg); color: var(--dv-unknown); }
  .dv-s-none { background: var(--dv-none-bg); color: var(--dv-none); }
  .dv-s-pass-edge { border-left: 4px solid var(--dv-pass-fill); }
  .dv-s-weak-edge { border-left: 4px solid var(--dv-weak-fill); }
  .dv-s-failing-edge { border-left: 4px solid var(--dv-fail-fill); }
  .dv-s-cant_tell-edge { border-left: 4px solid var(--dv-unknown); }
  .dv-bar { display: block; width: 100%; }
  .dv-f-pass { fill: var(--dv-pass-fill); }
  .dv-f-weak { fill: var(--dv-weak-fill); }
  .dv-f-failing { fill: var(--dv-fail-fill); }
  .dv-hatch-bg { fill: var(--dv-unknown-bg); }
  .dv-hatch-line { fill: var(--dv-unknown); }
  .dv-track { fill: var(--dv-track); }

  .dv-obj { display: grid; grid-template-columns: minmax(150px, 210px) 1fr minmax(220px, 280px); gap: 6px 16px; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border); }
  .dv-obj:last-child { border-bottom: 0; }
  .dv-obj-name { font-weight: 600; }
  .dv-sub { font-weight: 400; color: var(--muted); font-size: 12px; }
  .dv-objbar { height: 12px; border-radius: 6px; overflow: hidden; background: var(--dv-track); }
  .dv-obj-counts { font-size: 13px; }
  .dv-obj-off { color: var(--muted); }
  .dv-obj-off .dv-obj-name { font-weight: 400; }
  .dv-bar-off { background: repeating-linear-gradient(135deg, var(--dv-none-bg) 0 6px, transparent 6px 12px); border: 1px dashed var(--border); }
  .dv-obj-off .dv-obj-counts { font-style: italic; }

  .dv-strip { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
  .dv-stat { border-radius: 10px; padding: 12px 14px; }
  .dv-stat-n { font-size: 28px; font-weight: 800; line-height: 1.1; }
  .dv-stat-l { font-size: 13px; font-weight: 600; }

  .dv-fixes { display: grid; gap: 8px; }
  .dv-fix { display: grid; grid-template-columns: 28px 1fr; gap: 12px; background: var(--dv-panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }
  .dv-fix-rank { font-size: 18px; font-weight: 800; color: var(--muted); line-height: 1.3; text-align: center; }
  .dv-fix-group { font-size: 12px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 2px; }
  .dv-fix-action { font-weight: 600; font-size: 15px; margin-bottom: 6px; }
  .dv-fix-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 13px; }
  .dv-fix-holds { font-size: 12px; color: var(--muted); margin-top: 4px; }
  .dv-dot { color: var(--muted); }
  .dv-empty { background: var(--dv-panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; }

  .dv-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; }
  .dv-card { background: var(--dv-panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .dv-card-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .dv-card-title { font-weight: 700; font-size: 15px; }
  .dv-why { margin: 6px 0 10px; font-size: 13px; color: var(--muted); }
  .dv-checks { display: grid; gap: 8px; }
  .dv-check { padding: 8px 10px; border-radius: 8px; background: var(--card-bg); }
  .dv-check[data-status="weak"] { box-shadow: inset 3px 0 0 var(--dv-weak-fill); background: var(--dv-weak-bg); }
  .dv-check[data-status="failing"] { box-shadow: inset 3px 0 0 var(--dv-fail-fill); background: var(--dv-fail-bg); }
  .dv-check-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 13px; margin-bottom: 4px; }
  .dv-check-name { font-weight: 600; margin-right: auto; }
  .dv-flag { font-size: 11px; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 0 6px; }
  .dv-checkbar { height: 14px; overflow: visible; }
  .dv-mark { fill: var(--dv-mark); }
  .dv-check-foot { font-size: 12px; margin-top: 4px; }
  .dv-hint { color: var(--dv-unknown); }
  .dv-yn-v { display: inline-block; padding: 1px 10px; border-radius: 6px; font-weight: 700; font-size: 12px; }

  .dv-heat-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; background: var(--dv-panel); }
  .dv-heat { display: grid; grid-template-columns: minmax(170px, 1.6fr) repeat(var(--dv-cols), minmax(92px, 1fr)); min-width: 640px; }
  .dv-heat-row { display: contents; }
  .dv-heat-corner, .dv-heat-col { font-size: 11px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.03em; padding: 8px; border-bottom: 1px solid var(--border); }
  .dv-heat-rowhead { font-size: 13px; font-weight: 600; padding: 6px 8px; border-bottom: 1px solid var(--border); }
  .dv-cell { font-size: 12px; font-weight: 600; padding: 6px 8px; margin: 3px; border-radius: 6px; display: flex; align-items: center; gap: 4px; }
  .dv-cell.dv-s-none { font-weight: 400; background: transparent; }

  @media (max-width: 720px) {
    body { padding: 16px; }
    .dv-part { padding: 0 12px 12px; }
    .dv-part-head { margin: 0 -12px 12px; padding: 10px 12px; }
    .dv-card { padding: 12px; }
    .dv-card-head { flex-wrap: wrap; }
    .dv-obj { grid-template-columns: 1fr; gap: 4px; }
    .dv-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .dv-cards { grid-template-columns: 1fr; }
    .dv-fix { grid-template-columns: 20px 1fr; gap: 8px; padding: 10px 12px; }
  }
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

/** Shown under a live banner when the report names the org's hostname (--show-org). */
export const ORG_HOST_NOTE = "This report names your Salesforce org's hostname; remove --show-org before sharing.";

/** What the banner says left the machine when the AI summary was requested. */
export const NARRATIVE_EGRESS_TEXT = 'metric values (no record text) were sent to Anthropic for the AI summary';

/**
 * Single source of truth for both single-org report banners (render.ts's
 * renderReportHtml, plainReport.ts's renderPlainReportHtml) so they can
 * never disagree about whether a given run's data came from a live CRM, or
 * about what left the machine. `narrativeSent`: this run sent (or tried to
 * send) the narrative request to Anthropic. `orgHostShown` (live only): the
 * report names the org's hostname, so ORG_HOST_NOTE follows the banner.
 * Not used by
 * renderComparisonHtml (--all), which is fixture-only, never sends a
 * narrative and keeps its own banner markup unchanged.
 */
export function renderBanner(
  mode: 'fixture' | 'live',
  orgLabel: string,
  options?: { readonly narrativeSent?: boolean; readonly orgHostShown?: boolean },
): string {
  const sent = options?.narrativeSent ?? false;
  if (mode === 'live') {
    const left = sent ? NARRATIVE_EGRESS_TEXT : 'nothing else left this machine';
    const banner = `<div class="banner-live">LIVE DATA · read-only. Read from your Salesforce org; ${left}.</div>`;
    return options?.orgHostShown ? `${banner}
  <p class="note">${escapeHtml(ORG_HOST_NOTE)}</p>` : banner;
  }
  const left = sent ? NARRATIVE_EGRESS_TEXT : 'nothing leaves this machine';
  return `<div class="banner">MOCK DATA — fixture: ${escapeHtml(orgLabel)}. No real CRM was contacted; ${left}.</div>`;
}
