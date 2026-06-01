import test from "node:test";
import assert from "node:assert/strict";

import { redactRetrospectiveIssueText } from "../retrospective-redaction.ts";

const fakeGithubClassicToken = `gh${"p"}_abcdefghijklmnopqrstuvwxyz123456`;
const fakeGithubFineGrainedToken = `github_${"pat"}_1234567890abcdefghijklmnopqrstuvwxyz_ABCDEF`;
const fakeJwtToken = `eyJ${"hbGciOiJIUzI1NiJ9"}.${"eyJzdWIiOiIxMjM0NTY3ODkwIn0"}.signaturevalue`;
const fakeSlackBotToken = `xox${"b"}-123456789012-123456789012-abcdefghijklmnopqrstuvwxyz`;
const fakeSlackBrowserToken = `xox${"c"}-123456789012-123456789012-abcdefghijklmnopqrstuvwxyz`;
const fakeAwsAccessKey = `AK${"IA"}1234567890ABCDEF`;

test("redactRetrospectiveIssueText strips absolute paths and preserves project-relative artifact references", () => {
  const projectRoot = "/Users/seanspade/source/gsd-pi";
  const input = [
    "Failure in /Users/seanspade/source/gsd-pi/src/resources/extensions/gsd/auto.ts",
    "Artifact .gsd/milestones/M001/M001-RETRO.md should stay visible.",
    "Absolute artifact /Users/seanspade/source/gsd-pi/.gsd/milestones/M001/M001-RETRO-ISSUES.json should stay project-relative.",
    "Temp file /private/tmp/gsd-secret/output.log and /private/var/folders/ts/session.txt were present.",
    "Windows path C:\\Users\\Sean\\source\\gsd-pi\\secret.txt was logged.",
  ].join("\n");

  const redacted = redactRetrospectiveIssueText(input, projectRoot);

  assert.match(redacted, /<project>\/src\/resources\/extensions\/gsd\/auto\.ts/);
  assert.match(redacted, /\.gsd\/milestones\/M001\/M001-RETRO\.md/);
  assert.match(redacted, /\.gsd\/milestones\/M001\/M001-RETRO-ISSUES\.json/);
  assert.doesNotMatch(redacted, /<project>\/\.gsd/);
  assert.doesNotMatch(redacted, /\/Users\/seanspade/);
  assert.doesNotMatch(redacted, /\/private\/tmp/);
  assert.doesNotMatch(redacted, /\/private\/var/);
  assert.doesNotMatch(redacted, /C:\\Users\\Sean/);
});

test("redactRetrospectiveIssueText strips tokens and secret-style values while preserving commands", () => {
  const input = [
    `GITHUB_TOKEN=${fakeGithubClassicToken}`,
    "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
    "password: hunter2",
    "api_key: abc123secret",
    "Run pnpm run test:unit after fixing.",
  ].join("\n");

  const redacted = redactRetrospectiveIssueText(input, "/Users/seanspade/source/gsd-pi");

  assert.doesNotMatch(redacted, /ghp_[A-Za-z0-9_]+/);
  assert.doesNotMatch(redacted, /sk-proj-[A-Za-z0-9]+/);
  assert.match(redacted, /GITHUB_TOKEN=<redacted>/);
  assert.match(redacted, /OPENAI_API_KEY=<redacted>/);
  assert.match(redacted, /password: <redacted>/);
  assert.match(redacted, /api_key: <redacted>/);
  assert.match(redacted, /pnpm run test:unit/);
});

test("redactRetrospectiveIssueText strips standalone provider tokens", () => {
  const input = [
    `GitHub fine-grained token ${fakeGithubFineGrainedToken}`,
    `Authorization: Bearer ${fakeJwtToken}`,
    `Slack token ${fakeSlackBotToken}`,
    `Slack browser token ${fakeSlackBrowserToken}`,
    `AWS key ${fakeAwsAccessKey}`,
    "access_token: abc123secretvalue",
    "github_token: abc123secretvalue",
  ].join("\n");

  const redacted = redactRetrospectiveIssueText(input, "/Users/seanspade/source/gsd-pi");

  assert.doesNotMatch(redacted, /github_pat_/);
  assert.doesNotMatch(redacted, new RegExp(`eyJ${"hbGci"}`));
  assert.doesNotMatch(redacted, /xoxb-/);
  assert.doesNotMatch(redacted, /xoxc-/);
  assert.doesNotMatch(redacted, new RegExp(`AK${"IA"}1234567890ABCDEF`));
  assert.match(redacted, /access_token: <redacted>/);
  assert.match(redacted, /github_token: <redacted>/);
  assert.match(redacted, /Authorization: Bearer <redacted>/);
});
