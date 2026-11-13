# Changelog

All notable changes to Edit Creep are documented here. The project follows [Semantic Versioning](https://semver.org/).

## 1.0.0 — 2026-11-13

First public release.

### Added

- Two-slot loader with drag and drop, EXIF orientation and analysis at up to 1024 pixels.
- Automatic alignment of size, crop and offset with a coarse-to-fine search and sub-pixel polish; doubtful-alignment and cropped-area reporting.
- Resolution matching for smaller and larger edits.
- Robust global colour-drift fit, reported and optionally compensated.
- Anti-aliasing-tolerant CIELAB ΔE and shift-tolerant SSIM per pixel.
- Intended-area tools (paint, box, erase, clear), feathering, and "This was intended" per region.
- Region grouping with artefact filtering and merging of touching parts; colour, detail and content classification; severities and verdicts.
- Swipe, heatmap, onion-skin, original and edited views with numbered region boxes.
- Comparison-sheet PNG, heatmap PNG and JSON report exports.
- Low, balanced and high sensitivity.
- Synthetic demo pair, unit tests, Playwright browser tests and CI.
- Strict Content-Security-Policy with `connect-src 'none'`.

### Reliability and review clarity

- Cancel superseded image choices, workers and queued comparisons on replacement or reset.
- Protect current intended-area edits from stale responses and disable result actions during analysis.
- Map original-image report boxes independently on both axes with conservative bounds.
- Compare and display transparent images on white consistently.
- Distinguish threshold-based “No changes detected” from insufficient unmarked comparison area and uncertain alignment.
- Support arrow-key, Home and End navigation in view controls.
- Reject incompatible working-image dimensions and aspect ratios before the coarse alignment search.
- Document heuristic limits, privacy boundaries, setup and recovery from GitHub `main`.
