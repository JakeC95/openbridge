import { useEffect, useRef, useState } from "react";
import type { AssetRecord, CatalogHit, PoliigonAssetSummary, PolyHavenAssetSummary } from "../shared/types";
import { publicCardThumbnail, publicProviderLabel, type PublicAssetSummary, type PublicProviderId } from "../shared/public-providers";
import { hitThumb, typeLabel } from "./catalog-utils";
import { assetTypeLabel } from "./asset-visuals";
import { rankSearchEntries, type SearchMatch } from "./search-ranking";
import { useStore } from "./store";
import { usePoliigonStore } from "./poliigon-store";
import { usePolyHavenStore } from "./polyhaven-store";
import { usePublicStore } from "./public-store";

export type GlobalSuggestionScope = "all" | "local";

export interface GlobalSuggestion {
  key: string;
  provider: string;
  providerLabel: string;
  name: string;
  typeLabel: string;
  thumbnail: string | null;
  groupIndex: number;
  match: SearchMatch;
  popularity?: number | null;
  free?: boolean;
  open: () => void;
}

function closeOtherSelections(): void {
  useStore.getState().closeSelection();
  usePoliigonStore.getState().closeAsset();
  usePolyHavenStore.getState().closeAsset();
  usePublicStore.getState().close();
}

function megascansSuggestion(hit: CatalogHit, groupIndex: number): GlobalSuggestion {
  return {
    key: `megascans:${hit.id || hit.objectID}`,
    provider: "megascans",
    providerLabel: "Megascans",
    name: hit.name,
    typeLabel: typeLabel(hit.type),
    thumbnail: hitThumb(hit),
    groupIndex,
    match: {
      name: hit.name,
      typeLabel: typeLabel(hit.type),
      tags: [hit.asset_type, hit.category, hit.subCategory, hit.biome, hit.region].filter((value): value is string => Boolean(value)),
      categories: [...(hit.tags ?? []), ...(hit.categories ?? []), ...(hit.assetCategories ?? [])]
    },
    popularity: typeof hit.points === "number" ? hit.points : null,
    free: hit.points === 0,
    open: () => {
      closeOtherSelections();
      void useStore.getState().openHit(hit);
    }
  };
}

function poliigonSuggestion(hit: PoliigonAssetSummary, groupIndex: number): GlobalSuggestion {
  return {
    key: `poliigon:${hit.id}`,
    provider: "poliigon",
    providerLabel: "Poliigon",
    name: hit.name,
    typeLabel: assetTypeLabel(hit.typeLabel),
    thumbnail: hit.thumbnail,
    groupIndex,
    match: {
      name: hit.name,
      typeLabel: hit.typeLabel,
      tags: [...hit.tags, hit.assetName],
      categories: hit.categories
    },
    free: hit.free,
    open: () => {
      closeOtherSelections();
      void usePoliigonStore.getState().openAsset(hit);
    }
  };
}

function polyHavenSuggestion(hit: PolyHavenAssetSummary, groupIndex: number): GlobalSuggestion {
  return {
    key: `polyhaven:${hit.id}`,
    provider: "polyhaven",
    providerLabel: "Poly Haven",
    name: hit.name,
    typeLabel: assetTypeLabel(hit.typeLabel),
    thumbnail: hit.thumbnail,
    groupIndex,
    match: {
      name: hit.name,
      typeLabel: hit.typeLabel,
      tags: hit.tags,
      categories: [...hit.categories, hit.category, ...hit.collections]
    },
    popularity: hit.downloadCount,
    free: true,
    open: () => {
      closeOtherSelections();
      void usePolyHavenStore.getState().openAsset(hit);
    }
  };
}

function publicSuggestion(hit: PublicAssetSummary, groupIndex: number): GlobalSuggestion {
  return {
    key: `${hit.provider}:${hit.id}`,
    provider: hit.provider,
    providerLabel: publicProviderLabel(hit.provider),
    name: hit.name,
    typeLabel: assetTypeLabel(hit.typeLabel),
    thumbnail: publicCardThumbnail(hit, 256),
    groupIndex,
    match: {
      name: hit.name,
      typeLabel: hit.typeLabel,
      tags: hit.tags,
      categories: [...hit.categories, hit.category]
    },
    popularity: hit.downloadCount,
    free: hit.free,
    open: () => {
      closeOtherSelections();
      void usePublicStore.getState().open(hit);
    }
  };
}

function localSuggestion(asset: AssetRecord, groupIndex: number): GlobalSuggestion {
  return {
    key: `local:${asset.id}:${asset.path}`,
    provider: "library",
    providerLabel: "Library",
    name: asset.name,
    typeLabel: assetTypeLabel(asset.type),
    thumbnail: asset.thumb ? window.openbridge.toFileUrl(asset.thumb) : asset.preview ? window.openbridge.toFileUrl(asset.preview) : null,
    groupIndex,
    match: {
      name: asset.name,
      typeLabel: assetTypeLabel(asset.type),
      tags: asset.tags,
      categories: asset.categories
    },
    open: () => {
      closeOtherSelections();
      void useStore.getState().openLocal(asset);
    }
  };
}

function localCatalogueRequests(query: string, scope: GlobalSuggestionScope): Array<Promise<GlobalSuggestion[]>> {
  if (scope === "local") return [];
  return [
    window.openbridge.poliigon.search({ query, limit: 4, offset: 0, includeFacets: false }).then(result => result.hits.map(poliigonSuggestion)),
    window.openbridge.polyhaven.search({ query, limit: 4, offset: 0, includeFacets: false }).then(result => result.hits.map(polyHavenSuggestion)),
    window.openbridge.public.search({ provider: "ambientcg", query, limit: 3, offset: 0, includeFacets: false }).then(result => result.hits.map(publicSuggestion)),
    window.openbridge.public.search({ provider: "openhdri", query, limit: 3, offset: 0, includeFacets: false }).then(result => result.hits.map(publicSuggestion))
  ];
}

async function librarySuggestions(query: string): Promise<GlobalSuggestion[]> {
  const result = await window.openbridge.queryLibrary({ query, limit: 4, offset: 0, includeFacets: false });
  return result.assets.map(localSuggestion);
}

/** Fast local-only typeahead matches; remote providers remain on the full search. */
export function useGlobalSuggestions(
  query: string,
  enabled: boolean,
  scope: GlobalSuggestionScope
): { items: GlobalSuggestion[]; loading: boolean } {
  const [response, setResponse] = useState<{ query: string; scope: GlobalSuggestionScope; items: GlobalSuggestion[]; loading: boolean } | null>(null);
  const generation = useRef(0);
  const text = query.trim();

  useEffect(() => {
    if (!enabled || !text) {
      setResponse(null);
      return;
    }
    const current = ++generation.current;
    setResponse({ query: text, scope, items: [], loading: true });
    const timer = window.setTimeout(() => {
      const requests = localCatalogueRequests(text, scope);
      let pending = requests.length + 1;
      let collected: GlobalSuggestion[] = [];
      const add = (batch: GlobalSuggestion[]): void => {
        if (generation.current !== current) return;
        try {
          collected = [...collected, ...batch];
          const ranked = rankSearchEntries(text, collected.map(item => ({
            item,
            provider: item.provider,
            groupIndex: item.groupIndex,
            match: item.match,
            popularity: item.popularity,
            free: item.free
          }))).slice(0, 8);
          setResponse({ query: text, scope, items: ranked, loading: pending > 1 });
        } finally {
          pending -= 1;
        }
      };
      for (const request of requests) {
        void request.then(add).catch(() => add([]));
      }
      void librarySuggestions(text).then(add).catch(() => add([]));
    }, 60);
    return () => {
      generation.current += 1;
      window.clearTimeout(timer);
    };
  }, [enabled, text, scope]);

  if (!enabled || !text) return { items: [], loading: false };
  if (response?.query !== text || response.scope !== scope) return { items: [], loading: true };
  return response;
}
