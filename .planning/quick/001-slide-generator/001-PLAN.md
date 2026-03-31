# Slide Generator

## Goal
Create `presenter/slides.html` -- a CSS-only slide deck generator that takes session analysis data and renders 5 slides with arrow key navigation and dark theme.

## Success Criteria
1. File exists at `presenter/slides.html`
2. 5 slides: Title (visitor info), Demo highlights (key moments), AI-detected interests (confidence levels), Follow-up plan, Technical architecture (data flow)
3. CSS-only slides with arrow key navigation (left/right)
4. Dark theme consistent with existing boothapp design language
5. Loads sample data from `examples/sample_data.json` or accepts inline data
6. Works standalone in a browser with no build step
