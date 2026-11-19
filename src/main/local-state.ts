import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readdir, readFile, realpath, rename, rm, statfs, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { hostname } from "node:os";
import { backup, DatabaseSync } from "node:sqlite";

// Network filesystems and userspace mounts cannot be assumed to implement WAL locking.
const REMOTE_FILESYSTEMS = new Set([
  0x6969, 0xff534d42, 0xfe534d42, 0x517b, 0x5346414f, 0x73757245,
  0x00c36400, 0x01021997, 0x65735546
]);
const prepared = new Map<string, string>();
const MARKER = "sqlite-state.json";

export interface LocalStateOptions {
  platform?: NodeJS.Platform;
  override?: string;
  fallbackRoot?: string;
  filesystemType?: (path: string) => Promise<number>;
}

async function filesystemType(path: string): Promise<number> {
  return Number(BigInt((await statfs(path)).type) & 0xffffffffn);
}

async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() ||
      (process.getuid && info.uid !== process.getuid())) {
    throw new Error("The local database directory must be a regular directory owned by your account.");
  }
  if (process.platform !== "win32") await chmod(path, 0o700);
}

async function snapshot(source: string, target: string): Promise<void> {
  let db: DatabaseSync | undefined;
  try {
    // Online backup includes committed WAL records, unlike copying only .sqlite.
    db = new DatabaseSync(source, { readOnly: true });
    await backup(db, target);
    await chmod(target, 0o600);
  } catch (error) {
    throw new Error(`Could not migrate database ${source.split(/[\\/]/).at(-1)} to local storage. The original was preserved. ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    db?.close();
  }
}

async function databaseNames(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter(entry => entry.name.endsWith(".sqlite")).map(entry => {
    if (!entry.isFile()) throw new Error(`Cannot migrate ${entry.name}: the original database must be a regular file.`);
    return entry.name;
  });
}

async function activeDirectory(profile: string): Promise<{ directory: string; recorded: boolean }> {
  const canonicalProfile = await realpath(profile);
  let contents: string;
  try { contents = await readFile(join(profile, MARKER), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { directory: canonicalProfile, recorded: false };
    throw error;
  }
  let marker: { version?: number; directory?: string; host?: string; files?: string[] };
  try { marker = JSON.parse(contents); }
  catch { throw new Error("The SQLite state location record is invalid. Restore sqlite-state.json from backup before starting OpenBridge."); }
  if (marker?.version !== 1 || typeof marker.directory !== "string" || !isAbsolute(marker.directory) ||
      !Array.isArray(marker.files) || marker.files.some(name => typeof name !== "string" || !name.endsWith(".sqlite") || /[\\/]/.test(name))) {
    throw new Error("The SQLite state location record is invalid. Restore sqlite-state.json from backup before starting OpenBridge.");
  }
  if (resolve(marker.directory) !== canonicalProfile && marker.host !== hostname()) {
    throw new Error("The active SQLite state belongs to a different computer. Restore or transfer its persistent databases on this computer before starting OpenBridge.");
  }
  const info = await lstat(marker.directory).catch(() => null);
  if (!info?.isDirectory() || info.isSymbolicLink()) {
    throw new Error("The active SQLite state directory is unavailable. Restore its persistent databases before starting OpenBridge; original databases may be outdated.");
  }
  for (const name of marker.files) {
    const database = await lstat(join(marker.directory, name)).catch(() => null);
    if (!database?.isFile() || database.isSymbolicLink()) {
      throw new Error(`The active SQLite database ${name} is unavailable. Restore the persistent database before starting OpenBridge; original databases may be outdated.`);
    }
  }
  return { directory: marker.directory, recorded: true };
}

async function recordDirectory(profile: string, directory: string): Promise<void> {
  const temporary = join(profile, `${MARKER}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, JSON.stringify({ version: 1, directory, host: hostname(), files: await databaseNames(directory) }), { mode: 0o600 });
    await rename(temporary, join(profile, MARKER));
  } finally { await rm(temporary, { force: true }); }
}

async function relocate(source: string, target: string, recorded: boolean): Promise<void> {
  const names = await databaseNames(source);
  const existing = await databaseNames(target);
  if (existing.length && !recorded) {
    throw new Error("The destination already contains SQLite databases without an active-state record. Preserve both locations and restore sqlite-state.json before relocating; OpenBridge cannot determine which copy is current.");
  }
  // A different existing DB set can include records absent from the active profile.
  // Reject that conflict rather than silently dropping or merging unrelated state.
  if (existing.some(name => !names.includes(name))) {
    throw new Error("The destination contains additional SQLite databases. Choose an empty OPENBRIDGE_STATE_DIR or preserve and remove those databases before relocating.");
  }
  const staging = join(target, `.sqlite-relocation-${randomUUID()}`);
  await privateDirectory(staging);
  let preserved: string | undefined;
  try {
    // Finish every source snapshot before modifying any destination database.
    for (const name of names) await snapshot(join(source, name), join(staging, name));
    if (existing.length) {
      preserved = join(target, `.sqlite-before-relocation-${randomUUID()}`);
      await privateDirectory(preserved);
      for (const name of existing) await snapshot(join(target, name), join(preserved, name));
    }
    for (const name of names) {
      // Destination connections have not opened yet. Their committed WAL is in
      // the preserved snapshot; stale sidecars must not replay onto the new DB.
      await rm(join(target, `${name}-wal`), { force: true });
      await rm(join(target, `${name}-shm`), { force: true });
      await rename(join(staging, name), join(target, name));
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
    // Preserve old destination snapshots, including after a partial publish.
  }
}

/** Keep settings and account storage in userData, and SQLite on a local disk. */
export async function prepareLocalState(userData: string, options: LocalStateOptions = {}): Promise<string> {
  const profile = resolve(userData);
  await mkdir(profile, { recursive: true });
  // Read before creating a selected directory: a missing active location must
  // never be recreated and mistaken for a new/empty profile after cleanup.
  const active = await activeDirectory(profile);
  const platform = options.platform ?? process.platform;
  const getType = options.filesystemType ?? filesystemType;
  const override = (options.override ?? process.env.OPENBRIDGE_STATE_DIR ?? "").trim();
  const remoteProfile = platform === "linux" && REMOTE_FILESYSTEMS.has(await getType(profile));
  let target = await realpath(profile);
  if (override || remoteProfile) {
    if (override && !isAbsolute(override)) throw new Error("OPENBRIDGE_STATE_DIR must be an absolute path on a local disk.");
    const base = override || options.fallbackRoot || join("/var/tmp", `openbridge-state-${process.getuid?.() ?? "user"}`);
    await privateDirectory(base);
    const canonicalBase = await realpath(base);
    if (platform === "linux" && REMOTE_FILESYSTEMS.has(await getType(canonicalBase))) {
      throw new Error("OpenBridge databases require local storage. Set OPENBRIDGE_STATE_DIR to an owned directory on a local disk.");
    }
    const identity = platform === "win32" ? profile.toLowerCase() : profile;
    const key = createHash("sha256").update(identity).digest("hex").slice(0, 24);
    target = join(canonicalBase, key);
    await privateDirectory(target);
  }
  if (resolve(active.directory) !== resolve(target)) await relocate(active.directory, target, active.recorded);
  await recordDirectory(profile, target);
  prepared.set(profile, target);
  return target;
}

/** Constructors called after startup share the profile's selected database directory. */
export function localStatePath(userData: string, name: string): string {
  return join(prepared.get(resolve(userData)) ?? userData, name);
}

/** Record databases created during init before the app accepts user changes. */
export async function finalizeLocalState(userData: string): Promise<void> {
  const profile = resolve(userData);
  const directory = prepared.get(profile);
  if (!directory) throw new Error("SQLite state must be prepared before it is finalized.");
  await activeDirectory(profile);
  await recordDirectory(profile, directory);
}
