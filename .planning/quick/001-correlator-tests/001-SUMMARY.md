# Correlator Test Suite -- Summary

## What was done
- Created `analysis/lib/correlator.js` -- timeline merge logic (clicks + transcript + screenshots with 2s correlation window)
- Created `tests/fixtures/` with sample clicks, transcript, and screenshots JSON files
- Created `tests/unit/test-correlator.js` -- 42 tests using Node.js assert module

## Test coverage
| Category | Tests |
|----------|-------|
| Empty inputs | 4 |
| Clicks only | 6 |
| Transcript only | 6 |
| Merged timeline | 5 |
| Overlapping timestamps | 5 |
| Screenshot correlation | 8 |
| matchScreenshot helper | 5 |
| Full fixture integration | 3 |
| **Total** | **42** |

## Result
All 42 tests pass, exit code 0.
