# SE Coaching Engine

## Goal

Add an SE coaching analysis engine that evaluates booth demo transcripts and generates
actionable coaching feedback, written to `output/coaching.json`.

## Success Criteria

1. New `analysis/engines/coaching.py` module with `generate_coaching(data) -> dict`
2. Output contains four sections:
   - `questions_answered_well` -- questions the SE handled effectively
   - `questions_to_improve` -- questions that could have been answered better
   - `missed_product_areas` -- products that should have been demoed but weren't
   - `missed_buying_signals` -- visitor buying signals the SE didn't act on
3. Works with existing session data model (transcript, products_demonstrated, interests)
4. Tests in `tests/test_coaching.py` covering all four output sections
5. All tests pass
