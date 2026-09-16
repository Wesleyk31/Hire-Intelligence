# Page and pathway audit â€” 16 September 2026

## Coverage

All nine public pages were exercised at desktop 1280Ã—800 and mobile 375Ã—667: Home, Products, Solutions, Industries, Insights, About, Contact, Privacy and Terms.

All twelve operational modules were exercised at both sizes: Decision Desk, Commercial Intelligence, Opportunities, Projects, Map, Organisations & Delivery Teams, Equipment Demand, Resources, CRM, Reports, Alerts and Source Admin. Each has direct-route, reload and navigation coverage; all twelve also have empty-data coverage.

The complete Chrome suite contains **89 tests**: 66 coverage cases, 17 focused regressions, one large-report stress case and five original application cases. Final results appear in the main audit and BROWSER_RESULTS.json.

Pathways include navigation/footer links, browser history, sign-in gating, account switching/sign-out, all five feature links, search/stage/priority filters, project evidence entry points, map controls/selection, demo validation/failure/retry, all six CRM outcomes and QA flags, report preview/download/save/reload/history failures, source status, unknown routes and API failure recovery.

## Repairs

- Drawer/modal navigation, Escape, focus containment/restoration and body scrolling.
- Search retains projects needed to open matching events; filtered-out selections clear.
- Map recency uses source activity dates and excludes undated/future events.
- Leaflet source text cannot become executable tooltip HTML.
- Short-screen demo layout and full-width mobile empty messages.
- Overlapping Public site/Sign out controls and modal layering.
- About and module navigation scroll to the page heading.
- Current report-history response contract and bounded-history disclosure.
- Long PDF notes use measured pagination and continuation headings.

## Open visual failure

**The approved homepage JPEG is corrupt.** The local file and live response are both 5,128 bytes and fail image decoding. The source snapshot has an explicitly truncated base64 tail. Feature photos, hero strip and CTA background cannot render.

The image-decode regression remains a real failing test; it is not skipped or marked as an expected pass. The intact approved artwork is required for an exact repair. No unrelated imagery was substituted.

## PDF inspection

Stress fixture: 50 equipment clusters, 15 long fleet recommendations and 40 long source explanations. Before repair: 14,091 non-whitespace glyphs outside print margins. After repair: **15 pages, zero out-of-margin glyphs, all 15 end-markers and calibration/governance retained**. All 15 pages were rendered and visually inspected.

Reproduce with the large-report browser test and tests/browser/check_pdf_layout.py (Python/pdfplumber). These are synthetic QA artifacts, not customer intelligence.

## Limits

Browser APIs use synthetic fixtures. Real identity-provider behavior and deployed persistence need staging. Separate read-only navigation opened all 21 live pages with expected headings and no page JavaScript errors, but the live version still permits anonymous operational access.

This tested inventory cannot guarantee every input, browser, assistive technology, scale or third-party outage. Cross-browser/device accessibility and load testing remain acceptance work.
