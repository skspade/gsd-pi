export type RetrospectiveOutcome = "completed" | "failed" | "stuck" | "aborted";

export type RetrospectiveCategory =
  | "bug"
  | "prompt"
  | "workflow-friction"
  | "missing-agent"
  | "automation-idea"
  | "docs"
  | "other";

export type RetrospectiveSeverity = "low" | "medium" | "high";
export type RetrospectiveConfidence = "low" | "medium" | "high";

export interface RetrospectivePreferences {
  enabled?: boolean;
  issue_repo?: string;
  issue_label?: string;
  max_issues_per_run?: number;
}

export interface RetrospectiveFinding {
  title: string;
  summary: string;
  category: RetrospectiveCategory;
  severity: RetrospectiveSeverity;
  confidence: RetrospectiveConfidence;
  evidence: string[];
  suggestedFix: string;
  fingerprint: string;
}

export interface RetrospectiveRunMeta {
  milestoneId: string;
  outcome: RetrospectiveOutcome;
  reason?: string;
  generatedAt: string;
}

export interface RetrospectiveIssueRecord {
  fingerprint: string;
  title: string;
  category: RetrospectiveCategory;
  status: "created" | "pending" | "skipped";
  issueNumber?: number;
  issueUrl?: string;
  error?: string;
  body?: string;
  updatedAt: string;
}

export interface RetrospectiveIssueMap {
  version: 1;
  milestoneId: string;
  issueRepo: string;
  issueLabel: string;
  records: RetrospectiveIssueRecord[];
}
