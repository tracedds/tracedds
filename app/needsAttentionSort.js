const COMPLIANCE_ISSUE_TYPES = new Set(["expiring", "missing_proof", "recall"]);

function issueTypeRank(issue) {
  return COMPLIANCE_ISSUE_TYPES.has(issue.type) ? 0 : 1;
}

export function sortNeedsAttentionIssues(issues, severityMeta) {
  return issues
    .map((issue, index) => ({ issue, index }))
    .sort((a, b) => {
      const severityRank = (severityMeta[a.issue.severity]?.rank ?? 99) - (severityMeta[b.issue.severity]?.rank ?? 99);
      if (severityRank !== 0) return severityRank;

      const typeRank = issueTypeRank(a.issue) - issueTypeRank(b.issue);
      if (typeRank !== 0) return typeRank;

      return a.index - b.index;
    })
    .map(({ issue }) => issue);
}
