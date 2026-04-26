# Development Tools

This folder contains scripts and tools used during development and testing.

**These files are NOT used in production.** Production code is in `/src`.

## Contents

### Test Scripts
- `test-*.js` — Unit tests and validation scripts
- `confirm-v41-videos.js` — Video validation testing
- `create-valid-v41-videos.js` — Test data generation
- `create_test_video.sh` — Shell script for test video generation

### Production Generation Scripts (Kept for Reference)
- `prod-video-generator.js` — Legacy video generation (production uses content-generator instead)

### Analysis Scripts
- `analyze-*.js` — Performance and behavior analysis
- `audit-queue.js` — Queue state auditing
- `validate-hooks-in-generator.js` — Hook system validation

### Generation & Spike Research
- `generate_*.js` — Retention spike structure generation and testing
- `finalize_*.js` — Export finalization for experiments
- `final_*.js` — Experiment result reporting
- `calculate_*.js` — Retention spike calculations
- `adjust_*.js` — Parameter tuning and adjustment
- `update_export_with_corrected_spikes.js` — Export correction experiments
- `validate_prespikeramp_timing.js` — Spike timing validation

### Documentation
- `HOOK-SYSTEM-INTEGRATION.md` — Hook quality system integration guide
- `integrate-hooks-content-generator.md` — Integration instructions

## Usage

Run these scripts during development:
```bash
# Validate hook system
node dev-tools/validate-hooks-in-generator.js

# Test video generation
node dev-tools/test-confessional-hooks.js

# Generate test data
node dev-tools/create-valid-v41-videos.js
```

**Never import from this folder in production code.**

## Keep Production Code Clean

- Production services live in `/src/services/`
- Pipeline code stays in `/src/queue/`
- Configuration stays in project root (`package.json`, `.env`)

---

Created: 2026-04-26 as part of project cleanup
