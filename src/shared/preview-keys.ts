/**
 * Deterministic progress keys for temporary preview transfers. The main
 * process publishes them through the normal downloads channel and the
 * renderer uses the same keys to show live speed, size and ETA.
 */
export const previewProgressKey = {
  maps: (assetId: number): string => `poliigon-preview:${assetId}:maps`,
  map: (assetId: number, mapType: string): string =>
    `poliigon-preview:${assetId}:map:${mapType.trim().toLowerCase()}`,
  hdr: (assetId: number): string => `poliigon-preview:${assetId}:hdr`,
  polyMaps: (assetId: string): string => `polyhaven-preview:${assetId}:maps`,
  polyMap: (assetId: string, mapType: string): string =>
    `polyhaven-preview:${assetId}:map:${mapType.trim().toLowerCase()}`,
  polyHdr: (assetId: string): string => `polyhaven-preview:${assetId}:hdr`
};
