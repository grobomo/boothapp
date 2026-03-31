# Analysis Quality Scoring System

## Goal
Add a quality scoring system to `analysis/engines/analyzer.py` that evaluates AI-generated booth visitor analysis on four dimensions, retries below-threshold analyses with a more detailed prompt, and writes scores to `output/quality.json`.

## Success Criteria
1. `analyzer.py` scores analysis on: products identified (target 3+), follow-up actions (target 3+), presence of visitor quotes, specificity of recommendations
2. Each dimension produces a numeric score; total score determines pass/fail
3. Below-threshold analyses trigger automatic retry with enhanced prompt
4. Quality scores written to `output/quality.json`
5. Tests cover scoring logic, retry behavior, and JSON output
6. All existing tests still pass
