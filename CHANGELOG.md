# Changelog

## Unreleased

- Keep credentials out of invalid URL errors and reject unsupported base URLs.
- Bind demo Graphite ports to localhost and ignore local environment files and package archives.
- Document the local trust boundary and query resource limits.
- Validate release tags and skip prereleases in the npm publishing workflow.

## 0.1.0

Initial release.

- `graphite_find_metrics`: browse the metric tree, with glob support.
- `graphite_search_metrics`: substring or regex search over every metric path, backed by a cached
  `/metrics/index.json`.
- `graphite_query`: render any Graphite target expression and return per-series stats over the full-resolution data,
  plus datapoints consolidated into clock-aligned buckets.
- `graphite_list_functions`: list the server's render functions, or show full docs for one.
- Supports basic auth (env vars or credentials in the URL), custom headers, ISO-8601 or Graphite-relative times, and
  readable errors for auth, network and invalid-target failures.
- Absolute times give a `[from, until)` range, so `until: 2026-10-01` stops at the end of 30 September. Graphite on
  its own returns `(from, until]`, which pulls in a stray point from the next day.
