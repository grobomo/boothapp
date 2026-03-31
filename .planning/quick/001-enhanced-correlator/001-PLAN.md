# Enhanced Correlator

## Goal
Improve analysis/lib/correlator.js to produce a richer timeline by adding screenshot matching, speaker diarization alignment, product context from URL patterns, and interaction clustering.

## Success Criteria
1. Screenshot matching: each click links to the nearest screenshot by timestamp
2. Speaker diarization: if transcript has speaker labels, track who spoke at each click
3. Product context: URL patterns map to V1 product names
4. Interaction clusters: rapid sequential clicks (<2s gap) grouped into single interaction events
5. Output enhanced timeline.json with all additional fields
6. Tests pass covering all new features
