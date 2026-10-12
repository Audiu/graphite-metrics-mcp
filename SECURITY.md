# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/Audiu/graphite-metrics-mcp/security/advisories/new),
not in a public issue. Include the affected version, how to reproduce the problem and its impact. Leave out real
Graphite URLs, credentials and metric data.

## Supported versions

Fixes are released for the latest published version only.

## Scope

This is a local stdio server for a trusted MCP client, as described under
[Security and operating limits](README.md#security-and-operating-limits). Reports about credential handling, requests
sent to Graphite and data returned to the client are in scope. Resource use from wide queries or pathological regex
searches is a documented limit, not a vulnerability.
