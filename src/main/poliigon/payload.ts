import type { PoliigonAssetDetail, PoliigonDownloadOptions } from "../../shared/types";

const FORMAT_ORDER = ["jpg", "png", "tiff", "exr", "hdr"];
const ALPHA_FORMAT_ORDER = ["png", "tiff", "exr", "jpg"];

export interface PoliigonDownloadPayload {
  response_type: "json";
  assets: Array<Record<string, unknown>>;
}

export function pickPoliigonFormat(formats: string[], preferred?: string, mapType?: string): string {
  if (preferred && formats.includes(preferred)) return preferred;
  // Opacity/alpha maps cannot be JPEG; the provider rejects that pairing.
  const order = mapType && /opacity|alpha|mask/i.test(mapType) ? ALPHA_FORMAT_ORDER : FORMAT_ORDER;
  for (const format of order) if (formats.includes(format)) return format;
  return formats[0] ?? "jpg";
}

/** Build the `/assets/download` body used by the official addon. */
export function buildPoliigonDownloadPayload(
  detail: PoliigonAssetDetail,
  resolution: string,
  options?: Partial<PoliigonDownloadOptions>
): PoliigonDownloadPayload {
  const asset: Record<string, unknown> = {
    id: detail.id,
    name: detail.assetName,
    sizes: [resolution]
  };

  if (detail.type === "Textures" || detail.type === "Brushes") {
    if (detail.convention === 1) {
      const available = detail.maps.filter(map => map.type);
      const selected = options?.maps && options.maps.length > 0
        ? options.maps
            .map(choice => {
              const map = available.find(item => item.type === choice.type);
              return map
                ? { type: choice.type, format: pickPoliigonFormat(map.file_formats ?? [], choice.format, choice.type) }
                : null;
            })
            .filter((item): item is { type: string; format: string } => item !== null)
        : available.map(map => ({
            type: map.type as string,
            format: pickPoliigonFormat(map.file_formats ?? [], undefined, map.type)
          }));
      asset.maps = selected.length > 0
        ? selected
        : available.map(map => ({
            type: map.type as string,
            format: pickPoliigonFormat(map.file_formats ?? [], undefined, map.type)
          }));
    } else {
      const workflows = detail.maps.filter(map => map.workflow);
      const workflow = workflows[0]?.workflow ?? "REGULAR";
      const codes = workflows
        .filter(map => map.workflow === workflow)
        .flatMap(map => map.maps ?? []);
      const selected = options?.maps && options.maps.length > 0
        ? codes.filter(code => options.maps!.some(choice => choice.type === code))
        : codes;
      asset.workflows = [workflow];
      asset.type_codes = selected.length > 0 ? selected : codes;
    }
  } else if (detail.type === "Models") {
    const lods = options?.lods && options.lods.length > 0
      ? options.lods.filter(lod => detail.lods.includes(lod))
      : detail.lods;
    if (lods.length > 0) asset.lods = lods;
    if (options?.nativeMesh !== false) {
      asset.softwares = [options?.software || "Blender"];
      asset.renders = [options?.renderer || "Cycles"];
    } else {
      asset.softwares = ["Generic"];
    }
  }

  return { response_type: "json", assets: [asset] };
}
