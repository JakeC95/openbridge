# Security policy

## Supported versions

Security fixes target the latest published release.

## Reporting a vulnerability

Report vulnerabilities privately through the repository's **Security** tab using a private security
advisory. Do not open a public issue for a vulnerability, exposed token or credential.

Include the affected version, impact, reproduction steps and any suggested fix. Do not include real
tokens, passwords, account identifiers or downloaded proprietary assets.

## Scope

In scope:

- Credential or token exposure
- Authentication and session handling
- Download, extraction and update-path vulnerabilities
- Local API exposure
- Unsafe file handling or path traversal

Out of scope:

- Vulnerabilities in the original Quixel/Epic application or services
- Issues caused by sharing credentials or asset libraries publicly
- Requests to bypass access controls or entitlement checks

## Repository hygiene

The project does not accept committed credentials, private keys, personal paths, account details or
machine-specific data. Run `npm run check:public` before submitting changes. If a secret is exposed,
rotate it before reporting; removing it from the current tree does not remove it from Git history.
