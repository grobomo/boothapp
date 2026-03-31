# Judge Scorecard Page

## Goal
Create presenter/judge-scorecard.html -- a single-page summary for hackathon judges to quickly understand BoothApp.

## Success Criteria
1. Page loads at presenter/judge-scorecard.html with dark theme matching demo.html
2. Shows project name "BoothApp" and tagline "AI-Powered Trade Show Demo Capture"
3. Architecture diagram showing: badge scan -> demo capture -> AI analysis -> follow-up
4. Key metrics section (sessions processed, avg analysis time, components count)
5. Technology stack (AWS Bedrock Claude, S3, Lambda, Chrome Extension, Node.js)
6. Team members section
7. Link to live demo (demo.html)
8. Loads data from /api/sessions if available, falls back to static sample data
