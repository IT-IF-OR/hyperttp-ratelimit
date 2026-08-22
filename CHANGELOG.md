# Changelog

## [2.0.0] - 2026-08-22

### Changed

- **Breaking:** Migrated the rate-limit plugin to the Core v2 universal request/response envelope.
- **Breaking:** Updated the `@hyperttp/types` peer dependency to `^0.3.0`.
- Rate-limit hooks now operate on protocol-neutral `SendRequest`, `UniversalResponse`, and `RequestContext` values.
- Request and response data now follow the Core v2 `input`, `metadata`, and `data` envelope fields.
