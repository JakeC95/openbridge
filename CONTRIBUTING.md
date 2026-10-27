# Contributing

Thanks for helping improve OpenBridge.

## Before opening an issue

- Search existing issues first.
- Use the bug or feature request template.
- Redact account names, email addresses, tokens, local absolute paths, machine identifiers and
  downloaded asset URLs. Never post credentials or proprietary assets.

## Development setup

```powershell
npm ci
npm run typecheck
npm run check:public
npm run start
```

Copy `config.local.example.json` to `config.local.json` for legacy service credentials. That file is
git-ignored. Do not commit real credentials.

## Pull requests

- Keep changes focused and describe the user-visible effect.
- Run `npm run check` and a portable build when packaging changes.
- Add or update documentation for configuration, release or protocol changes.
- Do not add personal paths, account handles, email addresses, machine specs or secrets.
- Do not commit generated artifacts, logs, databases, downloaded assets or metadata packs.

The public-repository hygiene check runs in CI and must pass before merge.

## Releases

Releases are built from `v*` tags by the release workflow. Do not change release assets manually
except to attach the optional catalogue metadata pack. The release repository is derived from the
build environment and is not committed to source.

## License

By contributing, you agree that your contribution is licensed under the project's MIT license.
