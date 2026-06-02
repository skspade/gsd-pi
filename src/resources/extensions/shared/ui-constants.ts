// Shared UI constants that do not depend on @gsd/pi-tui.

export const GLYPH = {
	cursor:        "›",
	check:         "✓",
	checkedBox:    "[x]",
	uncheckedBox:  "[ ]",
	dotActive:     "●",
	dotDone:       "●",
	squareFilled:  "■",
	squareEmpty:   "□",
	separator:     "─",
	statusPending: "○",
	statusActive:  "●",
	statusDone:    "✓",
	statusFailed:  "✗",
	statusPaused:  "⏸",
	statusWarning: "⚠",
	statusSkipped: "–",
} as const;

export const INDENT = {
	/** Standard left margin for all content lines */
	base:        "  ",
	/** Option label indent (same as base, kept separate for clarity) */
	option:      "  ",
	/** Description line below an option label */
	description: "     ",
	/** Note line below a review answer */
	note:        "      ",
	/** Cursor + space (replaces base when cursor is shown) */
	cursor:      "› ",
} as const;

export type ProgressStatus =
	| "pending"
	| "active"
	| "done"
	| "failed"
	| "paused"
	| "warning"
	| "skipped";

export const STATUS_COLOR: Record<ProgressStatus, "dim" | "accent" | "success" | "error" | "warning"> = {
	pending:  "dim",
	active:   "accent",
	done:     "success",
	failed:   "error",
	paused:   "warning",
	warning:  "warning",
	skipped:  "dim",
};

export const STATUS_GLYPH: Record<ProgressStatus, string> = {
	pending:  GLYPH.statusPending,
	active:   GLYPH.statusActive,
	done:     GLYPH.statusDone,
	failed:   GLYPH.statusFailed,
	paused:   GLYPH.statusPaused,
	warning:  GLYPH.statusWarning,
	skipped:  GLYPH.statusSkipped,
};
