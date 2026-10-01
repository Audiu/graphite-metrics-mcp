# Contributing

Contributions are welcome: bug reports, Graphite compatibility fixes and new tools alike.

### Developing

Use npm and install the locked dependency graph with `npm ci`. Run `npm run check` before opening a pull request. It
type-checks, runs the test suite and builds `dist/`.

To try your changes against a real Graphite without one of your own:

```bash
npm run demo:graphite                          # throwaway Graphite in Docker, seeded with demo.* metrics
GRAPHITE_URL=http://localhost:8080 npm run inspect   # MCP Inspector UI against your build
npm run demo:graphite -- --stop
```

### Guidelines

- Keep tools read-only. This server is for looking at metrics, not for changing Graphite.
- Keep tool output compact. Agents pay for every token, so prefer summaries and consolidated datapoints over raw
  series.
- Update the README and CHANGELOG when behaviour changes.
- Commit messages should be verb based: `Adding ...`, `Fixing ...`, `Updating ...`, `Removing ...`.
