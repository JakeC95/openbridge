import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { build } from "esbuild";

const result = await build({ entryPoints: ["src/main/local-state.ts"], bundle: true,
  platform: "node", format: "esm", write: false });
const { prepareLocalState, localStatePath, finalizeLocalState } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const directory = await mkdtemp(join(tmpdir(), "openbridge-local-state-"));
const profile = join(directory, "profile");
const fallbackRoot = join(directory, "local");
const filesystemType = async path => path === profile ? 0x6969 : 0x58465342;
let source;
try {
  await mkdir(profile);
  await writeFile(join(profile, "settings.json"), '{"fixture":true}');
  source = new DatabaseSync(join(profile, "shared-organization.sqlite"));
  source.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE annotation(value TEXT); INSERT INTO annotation VALUES ('keep my rating')");
  const selected = await prepareLocalState(profile, { platform: "linux", override: "", fallbackRoot, filesystemType });
  assert.notEqual(selected, profile);
  assert.equal(localStatePath(profile, "download-history.sqlite"), join(selected, "download-history.sqlite"));
  const migrated = new DatabaseSync(join(selected, "shared-organization.sqlite"));
  assert.equal(migrated.prepare("SELECT value FROM annotation").get().value, "keep my rating");
  migrated.exec("UPDATE annotation SET value='new local rating'");
  migrated.close();
  assert.equal(source.prepare("SELECT value FROM annotation").get().value, "keep my rating");
  assert.equal(await readFile(join(profile, "settings.json"), "utf8"), '{"fixture":true}');
  await assert.rejects(readFile(join(selected, "settings.json")), { code: "ENOENT" });
  await prepareLocalState(profile, { platform: "linux", override: "", fallbackRoot, filesystemType });
  const reopened = new DatabaseSync(join(selected, "shared-organization.sqlite"));
  assert.equal(reopened.prepare("SELECT value FROM annotation").get().value, "new local rating");
  reopened.close();
  console.log("PASS remote profile migration includes committed WAL, preserves original/settings and keeps newer local data");

  source.close();
  source = undefined;
  if (process.platform !== "win32") {
    const alias = join(directory, "profile-alias");
    const aliasTarget = join(directory, "alias-target");
    await mkdir(aliasTarget);
    await symlink(aliasTarget, alias);
    const aliasOptions = { platform: "linux", override: "", filesystemType: async () => 0x58465342 };
    assert.equal(await prepareLocalState(alias, aliasOptions), await realpath(aliasTarget));
    assert.equal(await prepareLocalState(alias, aliasOptions), await realpath(aliasTarget));
    console.log("PASS symlinked settings profiles retain a valid canonical state record on restart");
  }

  const secondProfile = join(directory, "second-profile");
  const localOptions = { platform: "linux", override: "", filesystemType: async () => 0x58465342 };
  assert.equal(await prepareLocalState(secondProfile, localOptions), await realpath(secondProfile));
  const overridden = await prepareLocalState(secondProfile, { ...localOptions, override: fallbackRoot });
  assert.notEqual(overridden, selected);
  assert.equal(localStatePath(secondProfile, "library-index.sqlite"), join(overridden, "library-index.sqlite"));
  assert.equal(localStatePath(profile, "library-index.sqlite"), join(selected, "library-index.sqlite"));
  console.log("PASS local profile stays in place and explicit overrides keep profiles isolated");

  await assert.rejects(prepareLocalState(secondProfile, { ...localOptions, override: "relative" }), /absolute path/);
  await assert.rejects(prepareLocalState(secondProfile, { ...localOptions, override: fallbackRoot,
    filesystemType: async () => 0x6969 }), /local storage/);
  const brokenProfile = join(directory, "broken-profile");
  await mkdir(brokenProfile);
  await writeFile(join(brokenProfile, "broken.sqlite"), "not sqlite");
  await assert.rejects(prepareLocalState(brokenProfile, { ...localOptions, override: fallbackRoot }),
    /Could not migrate database broken.sqlite.*original was preserved/);
  assert.equal(await readFile(join(brokenProfile, "broken.sqlite"), "utf8"), "not sqlite");
  console.log("PASS invalid/remote overrides and broken source databases fail explicitly without deleting originals");

  // Relocate the latest active data, even when returning to stale originals.
  const secondBase = join(directory, "second-base");
  const moved = await prepareLocalState(profile, { ...localOptions, override: secondBase });
  let current = new DatabaseSync(join(moved, "shared-organization.sqlite"));
  assert.equal(current.prepare("SELECT value FROM annotation").get().value, "new local rating");
  current.exec("UPDATE annotation SET value='latest moved rating'");
  current.close();
  assert.equal(await prepareLocalState(profile, localOptions), await realpath(profile));
  current = new DatabaseSync(join(profile, "shared-organization.sqlite"));
  assert.equal(current.prepare("SELECT value FROM annotation").get().value, "latest moved rating");
  current.close();
  const preserved = (await readdir(profile)).find(name => name.startsWith(".sqlite-before-relocation-"));
  assert.ok(preserved);
  const original = new DatabaseSync(join(profile, preserved, "shared-organization.sqlite"));
  assert.equal(original.prepare("SELECT value FROM annotation").get().value, "keep my rating");
  original.close();
  const returned = await prepareLocalState(profile, { ...localOptions, override: fallbackRoot });
  current = new DatabaseSync(join(returned, "shared-organization.sqlite"));
  assert.equal(current.prepare("SELECT value FROM annotation").get().value, "latest moved rating");
  current.close();
  console.log("PASS A→B→profile→A preserves latest notes and snapshots overwritten destination databases");

  const unrecorded = join(directory, "unrecorded");
  await mkdir(unrecorded);
  const seed = new DatabaseSync(join(unrecorded, "notes.sqlite"));
  seed.exec("CREATE TABLE notes(value TEXT)"); seed.close();
  const unrecordedTarget = await prepareLocalState(unrecorded, { ...localOptions, override: secondBase });
  await rm(join(unrecorded, "sqlite-state.json"));
  await assert.rejects(prepareLocalState(unrecorded, { ...localOptions, override: secondBase }), /without an active-state record/);
  assert.ok(await readFile(join(unrecordedTarget, "notes.sqlite")));
  console.log("PASS unrecorded existing destinations fail instead of guessing which database is current");

  const freshProfile = join(directory, "fresh-profile");
  const freshState = await prepareLocalState(freshProfile, { ...localOptions, override: secondBase });
  const freshDb = new DatabaseSync(join(freshState, "shared-organization.sqlite"));
  freshDb.exec("CREATE TABLE notes(value TEXT)"); freshDb.close();
  await finalizeLocalState(freshProfile);
  await rm(join(freshState, "shared-organization.sqlite"));
  await assert.rejects(prepareLocalState(freshProfile, { ...localOptions, override: secondBase }), /active SQLite database shared-organization.sqlite is unavailable/);
  console.log("PASS finalized first-start databases cannot disappear silently from an existing state directory");

  const markerPath = join(profile, "sqlite-state.json");
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  await writeFile(markerPath, JSON.stringify({ ...marker, host: "different-fixture-computer" }));
  await assert.rejects(prepareLocalState(profile, localOptions), /different computer/);
  await writeFile(markerPath, JSON.stringify(marker));
  await rm(join(returned, "shared-organization.sqlite"));
  await assert.rejects(prepareLocalState(profile, localOptions), /active SQLite database shared-organization.sqlite is unavailable/);
  await rm(returned, { recursive: true, force: true });
  await assert.rejects(prepareLocalState(profile, localOptions), /active SQLite state directory is unavailable/);
  await assert.rejects(prepareLocalState(profile, { ...localOptions, override: fallbackRoot }), /unavailable/);
  console.log("PASS missing active state and another computer fail explicitly instead of restoring stale originals");

} finally {
  source?.close();
  await rm(directory, { recursive: true, force: true });
}
