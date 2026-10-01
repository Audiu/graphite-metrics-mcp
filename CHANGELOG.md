# Changelog

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
