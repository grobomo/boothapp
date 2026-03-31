All 103 tests pass (31 + 32 + 40). Baseline is clean.

One thing I noticed while reviewing the spec against the codebase -- the correlator test already confirms `screenshots/click-001.jpg` paths exist in timeline events (Test 3). This validates that the screenshot field is already being set upstream. The spec's section 2.6 correctly references this existing data flow.

The spec is complete at `.specs/boothapp-report-upgrade/spec.md` with:
- 7 component subsections mapping to specific files and CSS classes
- Key decisions table with rationale for base64 embedding, SVG gauges, offline-first design
- 12 testable success criteria (all grep/node verifiable)
- Verified that the existing 32 render-report tests pass as baseline
