/**
 * Writes the demo samples: the text samples (compared byte for byte by the
 * tests) and PNG screenshots of the two plain reports (GitHub shows .html
 * as source, so the docs embed these instead).
 *
 * Screenshots use playwright-core with an installed Chrome (`channel:
 * 'chrome'`), so nothing downloads a browser; GitHub's ubuntu runners ship
 * Chrome. Each report renders at a fixed viewport, full page.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { GLANCE_SCREENSHOT, renderTextSamples, runDemo, SCREENSHOTS, type DemoRun } from './demoKernel.js';

/** docs/demo/ at the repo root, where the committed samples live. */
export const SAMPLES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'demo');

export async function writeTextSamples(run: DemoRun, dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const written: string[] = [];
  for (const [name, content] of Object.entries(renderTextSamples(run))) {
    const file = path.join(dir, name);
    await writeFile(file, content, 'utf8');
    written.push(file);
  }
  return written;
}

/** Screenshots each plain report already written in `dir`. */
export async function writeScreenshots(dir: string): Promise<string[]> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome' });
  const written: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 800 }, colorScheme: 'light' });
    for (const [png, html] of Object.entries(SCREENSHOTS)) {
      await page.goto(pathToFileURL(path.join(dir, html)).href);
      const file = path.join(dir, png);
      await page.screenshot({ path: file, fullPage: true });
      written.push(file);
    }
  } finally {
    await browser.close();
  }
  return written;
}

/** The cropped "At a glance" screenshot (top of the plain report), written beside the full-length ones. */
export async function writeGlanceScreenshot(dir: string): Promise<string> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const { png, html, width, height } = GLANCE_SCREENSHOT;
    const page = await browser.newPage({ viewport: { width, height }, colorScheme: 'light' });
    await page.goto(pathToFileURL(path.join(dir, html)).href);
    const file = path.join(dir, png);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width, height } });
    return file;
  } finally {
    await browser.close();
  }
}

/** The --write-samples path: every text sample, then the screenshots. */
export async function writeSamples(
  dir: string = SAMPLES_DIR,
): Promise<{ run: DemoRun; written: string[]; glance: string }> {
  const run = await runDemo();
  const written = [...(await writeTextSamples(run, dir)), ...(await writeScreenshots(dir))];
  return { run, written, glance: await writeGlanceScreenshot(dir) };
}
