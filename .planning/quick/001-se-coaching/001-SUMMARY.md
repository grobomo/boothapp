# SE Coaching Engine -- Summary

## What was done

1. Created `analysis/engines/coaching.py` with `generate_coaching(data) -> dict`
2. Engine analyzes session transcripts using pattern matching to produce four coaching sections:
   - **questions_answered_well**: Q&A pairs where SE used strong indicators (demos, examples, specifics)
   - **questions_to_improve**: Q&A pairs with weak indicators (uncertainty, deflection)
   - **missed_product_areas**: Products from the catalog that match visitor interests/transcript but weren't demoed
   - **missed_buying_signals**: 10 buying signal patterns (pricing, timeline, POC, competitive, compliance, etc.) detected in transcript but not addressed in recommendations
3. Created `tests/test_coaching.py` with 47 tests across 9 test classes
4. All 68 tests pass (47 new + 21 existing)

## Output format

`generate_coaching_json(data)` returns JSON with the four sections plus a summary:
- `summary.overall_rating`: "strong" / "adequate" / "needs_improvement"
- Counts for questions analyzed, strong/weak answers, missed products, missed signals
