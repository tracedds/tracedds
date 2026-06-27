import assert from "node:assert/strict";
import test from "node:test";
import { sortNeedsAttentionIssues } from "./needsAttentionSort.js";

const severity = {
  urgent: { rank: 0 },
  high: { rank: 1 },
  medium: { rank: 2 },
  low: { rank: 3 },
};

test("sorts shuffled Needs Attention rows by severity before pagination", () => {
  const shuffled = [
    { id: "low-reorder", severity: "low", type: "needs_reorder" },
    { id: "medium-reorder", severity: "medium", type: "needs_reorder" },
    { id: "urgent-stock", severity: "urgent", type: "low_stock" },
    { id: "high-proof", severity: "high", type: "missing_proof" },
  ];

  assert.deepEqual(
    sortNeedsAttentionIssues(shuffled, severity).map((issue) => issue.id),
    ["urgent-stock", "high-proof", "medium-reorder", "low-reorder"],
  );
});

test("keeps compliance rows above reorder rows at the same severity", () => {
  const shuffled = [
    { id: "medium-reorder-a", severity: "medium", type: "needs_reorder" },
    { id: "medium-proof", severity: "medium", type: "missing_proof" },
    { id: "medium-expiring", severity: "medium", type: "expiring" },
    { id: "medium-reorder-b", severity: "medium", type: "low_stock" },
  ];

  assert.deepEqual(
    sortNeedsAttentionIssues(shuffled, severity).map((issue) => issue.id),
    ["medium-proof", "medium-expiring", "medium-reorder-a", "medium-reorder-b"],
  );
});

test("preserves incoming order within the same severity and issue class", () => {
  const shuffled = [
    { id: "high-proof-a", severity: "high", type: "missing_proof" },
    { id: "high-expiring", severity: "high", type: "expiring" },
    { id: "high-proof-b", severity: "high", type: "missing_proof" },
  ];

  assert.deepEqual(
    sortNeedsAttentionIssues(shuffled, severity).map((issue) => issue.id),
    ["high-proof-a", "high-expiring", "high-proof-b"],
  );
});
