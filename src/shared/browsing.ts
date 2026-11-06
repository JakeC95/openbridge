import type { CategoryNode } from "./types";

export function canonicalType(value: string): string {
  const type = value.toLowerCase().replace(/[\s_-]+/g, "");
  if (["3d", "3dasset", "3dassets", "model", "models"].includes(type)) return "3d";
  if (["3dplant", "3dplants"].includes(type)) return "3dplant";
  if (["texture", "textures", "surface", "surfaces"].includes(type)) return "surface";
  if (["hdri", "hdris"].includes(type)) return "hdri";
  return type;
}

export function localCategoryPath(type: string, categories: string[]): string[] {
  const root = canonicalType(type);
  const path = categories
    .flatMap(value => value.split("/"))
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  if (path.length && (canonicalType(path[0]) === root || canonicalType(path[0]) === `${root}s`)) path.shift();
  return [root || "unknown", ...path];
}

export function categoryLabel(value: string): string {
  if (value === "3d") return "3D Assets";
  if (value === "3dplant") return "3D Plants";
  if (value === "surface") return "Surfaces";
  if (value === "texture") return "Textures";
  if (value === "model") return "Models";
  if (value === "hdri") return "HDRIs";
  if (value === "atlas") return "Atlases";
  if (value === "brush") return "Brushes";
  if (value === "decal") return "Decals";
  if (value === "imperfection") return "Imperfections";
  if (value === "displacement") return "Displacements";
  return value.replace(/(^|[\s_-])\S/g, char => char.toUpperCase());
}

export function categoryTree(entries: Array<{ path: string[]; count: number }>): CategoryNode[] {
  const roots: CategoryNode[] = [];
  for (const entry of entries) {
    let nodes = roots;
    for (const key of entry.path) {
      let node = nodes.find(item => item.key === key);
      if (!node) {
        node = { key, label: categoryLabel(key), count: 0, children: [] };
        nodes.push(node);
      }
      node.count += entry.count;
      nodes = node.children;
    }
  }
  const sort = (nodes: CategoryNode[]): CategoryNode[] => nodes
    .sort((a, b) => a.label.localeCompare(b.label))
    .map(node => ({ ...node, children: sort(node.children) }));
  return sort(roots);
}
