# Security Policy

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** on this repository
(Security tab → Report a vulnerability) rather than a public issue. You
should get a first response within a few days.

## Scope notes

The deployed service (gw1-mcp.graphmaxer.workers.dev) is a stateless,
read-only computation service: no authentication, no accounts, no stored
data, no secrets in CI (registry publishing uses GitHub OIDC). Reports
about the codec, the validator, the Worker routes, or the CI supply chain
are all in scope.
