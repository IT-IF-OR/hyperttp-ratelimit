# Changelog

## [2.0.1] - 2026-08-25

### Added

- Added `"type": "module"` to `package.json` for native ES module support.

### Changed

- Updated `oxfmt` dependency to `^0.65.0`.
- Updated `oxlint` dependency to `^1.80.0`.

## [2.0.0] - 2026-08-22

### Changed

- **Breaking:** Migrated the rate-limit plugin to the Core v2 universal request/response envelope.
- **Breaking:** Updated the `@hyperttp/types` peer dependency to `^0.3.0`.
- Rate-limit hooks now operate on protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Request and response data now follow the Core v2 `input`, `metadata`, and `data` envelope fields.
