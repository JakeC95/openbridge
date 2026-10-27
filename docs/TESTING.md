# Testing

Use a disposable library folder for manual tests. Do not commit logs, screenshots, account details,
local absolute paths or downloaded asset files.

## Automated checks

```powershell
npm ci
npm run typecheck
npm run check:public
npm run build
npm run dist:portable
```

`check:public` fails if tracked files contain personal paths, email addresses, hard-coded account
names, machine-specific details or likely secrets.

## Manual smoke test

1. Start the app and confirm the portable window opens with the expected version.
2. Sign in with an Epic account and confirm the account view loads without exposing credentials.
3. Search the catalogue by name and open a result. Check category filters, facets, favorites and
   related assets.
4. Open a 3D plant, switch to **Maps**, and confirm reference maps and billboard maps load.
5. Open a surface and confirm 2D drawer restrictions: no mesh format, no per-LOD map controls.
6. Download one asset to a disposable library folder. Confirm files, JSON and previews finalize in
   the expected layout.
7. Rescan the library. Confirm indexed search, readiness filters, counts and health tools work.
8. Import a small catalogue metadata pack in Settings and confirm status and remote badges.
9. Check the update path against a local manifest or a published prerelease before publishing.

## Metadata pack checks

```powershell
npm run build
electron . --build-catalog-pack=dist/catalog-metadata-sample.json.gz --catalog-limit=50
electron . --import-catalog-pack=dist/catalog-metadata-sample.json.gz
```

Verify:

- The import reports the expected record count.
- Settings shows the pack count and generated date.
- A known asset exposes readiness, semantic and technical fields.
- Removing the pack returns the app to on-demand remote metadata.
- Full packs are generated only from an authenticated session and never committed.

## Release verification

- Confirm `npm run typecheck` and `npm run check:public` pass.
- Confirm the portable ZIP starts and reports the tagged version.
- Confirm the release contains the ZIP, `latest.json` and, when applicable,
  `catalog-metadata.json.gz`.
- Verify `latest.json` size and SHA-256 against the uploaded ZIP.
- Confirm the latest metadata-pack URL resolves when a pack is published.

## Destructive tests

Library deletion, queue cleanup, update replacement and forced shutdown should be tested only with
disposable data. Never run destructive tests against a real asset library.
