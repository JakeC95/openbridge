/** Shared colour language for asset types across every provider and view. */
export function assetTypeClass(label: string | null | undefined): string {
  const value = (label ?? "").toLowerCase();
  if (/hdri|environment|sky/.test(value)) return "type-hdri";
  if (/atlas/.test(value)) return "type-atlas";
  if (/decal/.test(value)) return "type-decal";
  if (/brush/.test(value)) return "type-brush";
  if (/imperfection/.test(value)) return "type-imperfection";
  if (/displacement/.test(value)) return "type-displacement";
  if (/plant|3d|model|mesh/.test(value)) return "type-3d";
  if (/surface|texture|material|tiling/.test(value)) return "type-surface";
  return "type-generic";
}

/** One shared vocabulary so both providers name the same asset type the same way. */
export function assetTypeLabel(label: string | null | undefined): string {
  const value = (label ?? "").trim();
  const lower = value.toLowerCase();
  if (/^(3d|model|models)$/.test(lower)) return "3D Model";
  if (/plant/.test(lower)) return "3D Plant";
  if (/texture|surface|material/.test(lower)) return "Surface";
  if (/hdri/.test(lower)) return "HDRI";
  if (/atlas/.test(lower)) return "Atlas";
  if (/decal/.test(lower)) return "Decal";
  if (/brush/.test(lower)) return "Brush";
  if (/imperfection/.test(lower)) return "Imperfection";
  if (/displacement/.test(lower)) return "Displacement";
  return value || "Asset";
}
