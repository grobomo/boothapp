# Slide Generator

## Goal
Create `analysis/engines/slide_generator.py` that generates a dark-themed HTML slide deck from completed session analysis data, with arrow-key navigation and 6 slide types.

## Success Criteria
1. File exists at `analysis/engines/slide_generator.py`
2. Generates `output/slides.html` with 6 slides: Title, Products, Discussion Points, Competitive Landscape, Next Steps, Engagement Score
3. Arrow-key navigation (left/right) between slides
4. Dark theme consistent with Trend Micro branding
5. Full-screen sections (each slide is 100vw x 100vh)
6. Products slide has time-spent bars
7. Engagement Score slide has visual scorecard
8. Tests pass in `tests/test_slide_generator.py`
9. HTML is valid and XSS-safe (html.escape on user data)
