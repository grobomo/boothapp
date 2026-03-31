Confirmed: `background.js` has 3 places that write `v1helper_session` to storage, and none include `visitor_name`. The spec correctly identifies all the change points (lines 299, 306, and 440).

The spec is complete, internally consistent, and references the correct lines/structures in the codebase. Spec delivered at `.specs/popup-redesign/spec.md`.
