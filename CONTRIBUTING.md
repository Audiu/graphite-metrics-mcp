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

### Releasing (maintainers)

Before the public launch, enable GitHub secret scanning, push protection and private vulnerability reporting,
and add a security policy pointing to the private reporting channel. Review branch protection for `main`.

The npm package must be available before the README's `npx` installation works. Establish package ownership
and publishing access on npm before creating the first GitHub release. Configure
[npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) for owner `Audiu`, repository
`graphite-metrics-mcp`, workflow `publish.yml`, with direct publishing allowed. The repository must be public
for the workflow's provenance attestation. These are account settings, not settings stored in this repository.

For each release:

1. Update `package.json`, `package-lock.json` and `CHANGELOG.md` together.
2. Run `npm ci --ignore-scripts`, `npm run check`, `npm audit --audit-level=high` and `npm pack --dry-run`.
3. Publish a GitHub release tagged `v` followed by the exact package version (for example `v0.1.0`). This starts
   the npm publishing workflow. Prereleases are skipped so they cannot replace npm's `latest` release.
4. Verify the published version with `npm view graphite-metrics-mcp version`, then test installation from npm.

Remove the README's first-release notice once the package is available.
