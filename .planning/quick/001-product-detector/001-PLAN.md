# Product Detector Engine

## Goal
Add V1 product detection to the analysis pipeline. Given clicks.json, identify which Vision One products/features were demonstrated and output structured stats to output/products.json.

## Success Criteria
- [x] `analysis/engines/product_detector.py` exists with `detect_products()` function
- [x] Maps URL patterns to products per spec (xdr, search, workbench, cloud-security, risk-insights, endpoint, email, network)
- [x] Reuses existing `v1_features.json` config for URL pattern matching
- [x] Outputs `products_demonstrated` array with: name, time_spent_seconds, click_count, screenshots_count
- [x] Writes to output/products.json
- [x] Works standalone (CLI) and as importable module
- [x] Tests pass with sample data
- [x] Integrated into analyze.py pipeline (products.json written alongside summary.json)
