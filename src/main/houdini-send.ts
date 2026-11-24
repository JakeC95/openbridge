import { createConnection } from "node:net";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import { isInside } from "./shared-library";

const maxMessage = 64 * 1024;
const roles = ["base_color", "specular_roughness", "metalness", "normal"] as const;
type Role = typeof roles[number];
type Material = {
  group: string;
  maps: Partial<Record<Role, { path: string; colorSpace?: string; fileColorSpace?: string }>>;
  baseColor?: [number, number, number];
  roughness?: number;
};

export async function houdiniRecipe(indexedPath: string, roots: string[]) {
  const sidecar = `${indexedPath}.houdini.json`;
  const info = await lstat(sidecar).catch(() => null);
  if (!info) throw new Error("This asset has no verified Houdini handoff recipe. Its preview is not an import source.");
  if (!info.isFile() || info.size > maxMessage) throw new Error("Invalid Houdini handoff recipe.");
  const raw = JSON.parse(await readFile(sidecar, "utf8"));
  if (raw?.schemaVersion !== 1 || typeof raw.metersPerUnit !== "number" ||
      !Number.isFinite(raw.metersPerUnit) || raw.metersPerUnit <= 0 ||
      raw.upAxis !== "Y" || !Array.isArray(raw.materials) ||
      !raw.materials.length || raw.materials.length > 64) {
    throw new Error("The Houdini recipe needs verified source units, Y-up geometry and material bindings.");
  }
  const allowed = (await Promise.all(roots.map(root => realpath(root).catch(() => null)))).filter(x => x !== null);
  async function file(value: unknown) {
    if (typeof value !== "string" || !value || /[\x00-\x1f$`\\]/.test(value)) throw new Error("Invalid source path.");
    const path = await realpath(isAbsolute(value) ? value : resolve(dirname(indexedPath), value))
      .catch(() => { throw new Error(`Required Houdini source file is missing: ${value}`); });
    if (!allowed.some(root => isInside(root, path)) || !(await stat(path)).isFile() || /[\x00-\x1f$`\\]/.test(path)) {
      throw new Error(`Houdini source is not a regular file in a registered library: ${value}`);
    }
    return path;
  }
  const geometry = await file(raw.geometry);
  const format = extname(geometry).toLowerCase();
  if (![".obj", ".abc"].includes(format)) throw new Error("Houdini requires explicit OBJ or Alembic source geometry.");
  const materials: Material[] = [];
  const groups = new Set();
  for (const material of raw.materials) {
    const groupPattern = format === ".abc" ? /^(?:\/[a-zA-Z0-9_.-]+)+$/ : /^[a-zA-Z0-9_]*$/;
    const unit = (value: unknown): value is number => typeof value === "number" && value >= 0 && value <= 1;
    const color = material?.baseColor;
    if (typeof material?.group !== "string" || !groupPattern.test(material.group) ||
        (!material.group && raw.materials.length !== 1) || groups.has(material.group) ||
        !material.maps || typeof material.maps !== "object" || Array.isArray(material.maps) ||
        Object.keys(material.maps).some(role => !roles.includes(role as Role)) ||
        (color !== undefined && !(Array.isArray(color) && color.length === 3 && color.every(unit))) ||
        (material.roughness !== undefined && !unit(material.roughness)) ||
        (!material.maps.base_color && color === undefined)) {
      throw new Error("The Houdini recipe needs unique source assignments and an explicit base-color map or value for every material.");
    }
    groups.add(material.group);
    const maps: Material["maps"] = {};
    for (const role of roles) {
      const map = material.maps[role];
      if (!map) continue;
      const encoding = map.fileColorSpace ?? map.colorSpace;
      if (typeof encoding !== "string" || !/^[\w .()+-]{1,80}$/.test(encoding) ||
          (map.fileColorSpace !== undefined && encoding.toLowerCase() === "auto")) {
        throw new Error(`Specify the Arnold color space for ${role}.`);
      }
      maps[role] = { path: await file(map.path),
        ...(map.fileColorSpace !== undefined ? { fileColorSpace: encoding } : { colorSpace: encoding }) };
    }
    materials.push({ group: material.group, maps,
      ...(color !== undefined ? { baseColor: color } : {}),
      ...(material.roughness !== undefined ? { roughness: material.roughness } : {}) });
  }
  return { geometry, metersPerUnit: raw.metersPerUnit as number, materials };
}

export async function houdiniSessions() {
  if (process.platform !== "linux") return [];
  const uid = process.getuid!();
  const runtime = process.env.XDG_RUNTIME_DIR;
  const directory = join(runtime && isAbsolute(runtime) ? runtime : "/tmp", `openbridge-houdini-${uid}`);
  const info = await lstat(directory).catch(() => null);
  if (!info) return [];
  if (!info.isDirectory() || info.uid !== uid || (info.mode & 0o077)) {
    throw new Error("The Houdini connector directory must be private to your user.");
  }
  const sessions = [];
  for (const name of await readdir(directory)) {
    const match = /^(\d+)\.sock$/.exec(name);
    if (!match) continue;
    const path = join(directory, name);
    const socket = await lstat(path).catch(() => null);
    if (!socket?.isSocket() || socket.uid !== info.uid) continue;
    try { process.kill(Number(match[1]), 0); } catch { continue; }
    const status = await request(path, { action: "status" }, 1200).catch(() => null);
    if (status?.scene) sessions.push({ path, scene: status.scene, target: status.target ?? "No network selected", token: status.token });
  }
  return sessions;
}

type Reply = { error?: string; scene?: string; target?: string; token?: string; node?: string };
export function request(path: string, payload: object, timeout = 30_000): Promise<Reply> {
  const message = JSON.stringify(payload);
  if (Buffer.byteLength(message) >= maxMessage) throw new Error("Houdini handoff exceeds the pilot message limit.");
  return new Promise((fulfill, reject) => {
    const socket = createConnection(path);
    let response = "";
    const fail = (error: Error) => { socket.destroy(); reject(error); };
    socket.setEncoding("utf8");
    socket.setTimeout(timeout, () => fail(new Error("Houdini did not confirm the request. Check the scene before trying again.")));
    socket.once("error", fail);
    socket.once("end", () => fail(new Error("Houdini disconnected without confirming the request.")));
    socket.once("connect", () => socket.write(`${message}\n`));
    socket.on("data", chunk => {
      response += chunk;
      if (Buffer.byteLength(response) >= maxMessage) return fail(new Error("Invalid reply from Houdini."));
      const end = response.indexOf("\n");
      if (end < 0) return;
      try {
        const reply: Reply = JSON.parse(response.slice(0, end));
        if (reply.error) return fail(new Error(reply.error));
        fulfill(reply);
        socket.destroy();
      } catch { fail(new Error("Invalid reply from Houdini.")); }
    });
  });
}
