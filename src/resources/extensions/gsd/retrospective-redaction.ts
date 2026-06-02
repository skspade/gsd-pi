export function redactRetrospectiveIssueText(text: string, projectRoot: string): string {
  let redacted = text;

  redacted = redactProjectRoot(redacted, projectRoot);
  redacted = redacted.replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "<redacted>");
  redacted = redacted.replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "<redacted>");
  redacted = redacted.replace(/\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, "<redacted>");
  redacted = redacted.replace(/\bxox[a-z]-[A-Za-z0-9-]{10,}\b/g, "<redacted>");
  redacted = redacted.replace(/\bAKIA[0-9A-Z]{16}\b/g, "<redacted>");
  redacted = redacted.replace(
    /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{20,}/gi,
    "Authorization: Bearer <redacted>",
  );
  redacted = redacted.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)[A-Za-z0-9_]*)\s*=\s*("[^"\n]*"|'[^'\n]*'|[^\s\n]+)/gi,
    "$1=<redacted>",
  );
  redacted = redacted.replace(
    /\b([A-Za-z_][A-Za-z0-9_]*(?:token|api[_-]?key|secret|password)[A-Za-z0-9_]*|token|api[_-]?key|secret|password)\s*:\s*("[^"\n]*"|'[^'\n]*'|[^\s\n]+)/gi,
    "$1: <redacted>",
  );
  redacted = redacted.replace(/\/Users\/[^/\s]+\/[^\s)'"`]+/g, "<path>");
  redacted = redacted.replace(/\/private\/(?:tmp|var)\/[^\s)'"`]+/g, "<path>");
  redacted = redacted.replace(/[A-Za-z]:\\Users\\[^\\\s]+\\[^\s)'"`]+/g, "<path>");

  return redacted;
}

function redactProjectRoot(text: string, projectRoot: string): string {
  const normalizedRoot = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  if (!normalizedRoot) return text;

  return text
    .replaceAll(normalizedRoot, "<project>")
    .replaceAll("<project>/.gsd/", ".gsd/");
}
