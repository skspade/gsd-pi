/**
 * /gsd show-config command behavior tests.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GSDConfigOverlay, formatConfigText } from "../config-overlay.ts";
import { handleCoreCommand } from "../commands/handlers/core.ts";

const theme = {
  bold: (s: string) => s,
  fg: (_name: string, s: string) => s,
};

function withPreferences(content: string, fn: () => void): void {
  const originalCwd = process.cwd();
  const originalGsdHome = process.env.GSD_HOME;
  const tempProject = mkdtempSync(join(tmpdir(), "gsd-show-config-project-"));
  const tempGsdHome = mkdtempSync(join(tmpdir(), "gsd-show-config-home-"));

  try {
    mkdirSync(join(tempProject, ".gsd"), { recursive: true });
    writeFileSync(join(tempProject, ".gsd", "PREFERENCES.md"), content, "utf-8");
    process.env.GSD_HOME = tempGsdHome;
    process.chdir(tempProject);
    fn();
  } finally {
    process.chdir(originalCwd);
    if (originalGsdHome === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = originalGsdHome;
    rmSync(tempProject, { recursive: true, force: true });
    rmSync(tempGsdHome, { recursive: true, force: true });
  }
}

test("GSDConfigOverlay renders and responds to input", () => {
  let renderRequests = 0;
  let closed = false;
  const overlay = new GSDConfigOverlay(
    { requestRender: () => { renderRequests++; } },
    theme as any,
    () => { closed = true; },
  );

  const lines = overlay.render(60);
  assert.ok(lines.some((line) => line.includes("GSD Configuration")));

  overlay.handleInput("j");
  assert.equal(renderRequests, 1);

  overlay.handleInput("q");
  assert.equal(closed, true);
});

test("formatConfigText provides a text fallback", () => {
  const text = formatConfigText();
  assert.match(text, /GSD Configuration/);
  assert.match(text, /SOURCES/);
});

test("formatConfigText explains when burn-max and job models make routing inactive", () => {
  withPreferences(
    [
      "---",
      "token_profile: burn-max",
      "models:",
      "  execution: openai-codex/gpt-5.5",
      "  subagent: openai-codex/gpt-5.4-mini",
      "dynamic_routing:",
      "  enabled: true",
      "  tier_models:",
      "    light: deepseek-v4-flash",
      "    standard: deepseek-v4-flash",
      "    heavy: deepseek-v4-pro",
      "---",
    ].join("\n"),
    () => {
      const text = formatConfigText();

      assert.match(text, /execution\s+openai-codex\/gpt-5\.5 \(job model; routing skipped\)/);
      assert.match(text, /execution_simple\s+openai-codex\/gpt-5\.5 \(job model; routing skipped\)/);
      assert.match(text, /subagent\s+openai-codex\/gpt-5\.4-mini \(job model; routing skipped\)/);
      assert.match(text, /Configured\s+yes/);
      assert.match(text, /Effective\s+no \(token_profile burn-max\)/);
      assert.match(text, /Pinned jobs\s+execution, execution_simple, subagent \(skip routing\)/);
    },
  );
});

test("formatConfigText shows tiered jobs when routing can synthesize model choices", () => {
  withPreferences(
    [
      "---",
      "dynamic_routing:",
      "  enabled: true",
      "  tier_models:",
      "    light: deepseek-v4-flash",
      "    standard: deepseek-v4-flash",
      "    heavy: deepseek-v4-pro",
      "---",
    ].join("\n"),
    () => {
      const text = formatConfigText();

      assert.match(text, /research\s+\(tiered by dynamic routing\)/);
      assert.match(text, /execution\s+\(tiered by dynamic routing\)/);
      assert.match(text, /Effective\s+yes/);
      assert.match(text, /Tiered jobs\s+research, planning, discuss, execution/);
    },
  );
});

test("core handler routes show-config to overlay with text fallback", async () => {
  const notifications: Array<{ message: string; level: string }> = [];
  const ctx = {
    ui: {
      custom: async () => undefined,
      notify: (message: string, level: string) => {
        notifications.push({ message, level });
      },
    },
  };

  const handled = await handleCoreCommand("show-config", ctx as any);

  assert.equal(handled, true);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0]?.level, "info");
  assert.match(notifications[0]?.message ?? "", /GSD Configuration/);
});
