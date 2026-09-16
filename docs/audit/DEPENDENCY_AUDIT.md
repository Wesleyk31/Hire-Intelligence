# Dependency audit — 16 September 2026

`pnpm audit --json` initially reported 30 known advisories: 2 critical, 10 high, 15 moderate and 3 low. They affected the old PDF package, its DOMPurify dependency and the spreadsheet parser. Severity is the upstream package advisory rating; this scan does not show that every vulnerable feature was exercised by Hire Intelligence.

Applied upstream updates:

- jsPDF 2.5.2 → 4.2.1, following the [maintainer release notes](https://github.com/parallax/jsPDF/releases/tag/v4.2.1).
- jsPDF-AutoTable 3.8.4 → 5.0.8, compatible with jsPDF 4. The [maintainer migration notes](https://github.com/simonbengtsson/jsPDF-AutoTable/releases) describe the current import/API behavior.
- SheetJS 0.18.5 → 0.20.3 using the tarball published in the [official Node installation instructions](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/). The public npm `xlsx` package is outdated; the package file and lockfile retain the exact authoritative distribution URL and integrity hash.

The subsequent dependency scan reports **zero known vulnerabilities**. Browser PDF generation, frontend/backend type checks and workbook parser regression tests are included in the integrated validation. The exact before/after advisory inventory is in [DEPENDENCY_AUDIT.json](DEPENDENCY_AUDIT.json).