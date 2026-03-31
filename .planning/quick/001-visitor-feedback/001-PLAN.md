# Visitor Feedback Form

## Goal
Create a visitor-facing feedback form at `presenter/feedback.html` that SEs share after a demo session. Collects rating, product interests, free-text comments, contact preference, and consent. Saves to S3 `sessions/<id>/feedback.json`.

## Success Criteria
- [ ] Form accessible at `presenter/feedback.html?session=<id>`
- [ ] 1-5 star rating for demo quality
- [ ] Product interest checkboxes (matching V1 product categories)
- [ ] Free-text field for additional interests/questions
- [ ] Contact preference radio (email, phone, both)
- [ ] "Yes, contact me" consent checkbox
- [ ] Submit saves `feedback.json` to S3 `sessions/<id>/`
- [ ] Thank-you page shown after submission
- [ ] Dark theme matching existing presenter pages
- [ ] Mobile-friendly responsive layout
- [ ] No login required (visitor-facing, uses S3 credentials from localStorage)
