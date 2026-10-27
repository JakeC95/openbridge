import type { CategoryNode } from "./types";

export function canonicalType(value: string): string {
  const type = value.toLowerCase().replace(/[\s_-]+/g, "");
  if (["3d", "3dasset", "3dassets"].includes(type)) return "3d";
  if (["3dplant", "3dplants"].includes(type)) return "3dplant";
  return type;
}

export function localCategoryPath(type: string, categories: string[]): string[] {
  const root = canonicalType(type);
  const path = categories.map(value => value.trim().toLowerCase()).filter(Boolean);
  if (path.length && canonicalType(path[0]) === root) path.shift();
  return [root || "unknown", ...path];
}

export function categoryLabel(value: string): string {
  if (value === "3d") return "3D Assets";
  if (value === "3dplant") return "3D Plants";
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
