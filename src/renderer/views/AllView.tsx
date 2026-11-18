import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type {
  AssetProvider,
  CatalogHit,
  PoliigonAssetSummary,
  PolyHavenAssetSummary
} from "../../shared/types";
import { catalogFilterQuery } from "../browsing-state";
import { ALL_SOURCE_TREE, allSourceCategory, type AllSort, type AllStateFilter } from "../all-sources";
import { AssetCard } from "../components/AssetCard";
import { AssetList } from "../components/AssetList";
import { BrowsingMenu, DensityControl, FilterWorkbench, PackBrowser, RecentBrowsing, type FilterGroup } from "../components/BrowsingTools";
import { TimeOfDaySlider } from "../components/TimeOfDaySlider";
import { formatClockValue, formatHdriTime } from "../../shared/hdri-time";
import { skyConditionLabel, skyConditionRank } from "../../shared/sky-conditions";
import {
  POLYHAVEN_ATTRIBUTE_TYPES,
  polyHavenAttributeLabel,
  polyHavenAttributeValue,
  polyHavenMapLabel,
  polyHavenMapRank,
  polyHavenPrimaryPreview
} from "../../shared/polyhaven";
import { Dropdown } from "../components/Dropdown";
import { LoadMore } from "../components/LoadMore";
import { PoliigonCard } from "../components/PoliigonCard";
import { PolyHavenCard } from "../components/PolyHavenCard";
import { ProviderLogo } from "../components/ProviderLogo";
import { VirtualGrid } from "../components/VirtualGrid";
import { assetCountLabel, galleryFacts, hitId, hitPreview, hitThumb, readinessBadges, resolutionFacetValue, sortBucketsBy, sortResolutionBuckets, sortResolutionRecord, typeLabel } from "../catalog-utils";
import { assetTypeLabel } from "../asset-visuals";
import { ChevronDownIcon, CloseIcon, UserIcon } from "../icons";
import { poliigonTechnical } from "../poliigon-technical";
import { poliigonMapName, poliigonMapRank } from "../poliigon-labels";
import { polyHavenTechnical } from "../polyhaven-technical";
import { usePoliigonStore } from "../poliigon-store";
import { usePolyHavenStore } from "../polyhaven-store";
import { useStore } from "../store";
import { SIZE_FILTER_LABELS, SIZE_FILTER_OPTIONS, sizeBounds } from "../size-filter";
import { useBrowseScroll } from "../use-browse-scroll";
import { PUBLIC_PROVIDER_IDS, parsePublicJobId, publicCardThumbnail, publicJobId, publicProviderLabel, type PublicAssetSummary, type PublicCatalogQuery, type PublicProviderId } from "../../shared/public-providers";
import { usePublicStore, publicCategoryQuery, publicTypesForRoot } from "../public-store";
import { normalizePublicQuery } from "../public-preferences";
import { PublicCard } from "../components/PublicAsset";
import { publicProviderFacts, publicTechnical } from "../public-technical";
import { rankSearchEntries, type SearchMatch } from "../search-ranking";

function hdriFilterRank(key: string): number {
  if (key === "poli:weather") return 0;
  if (key === "poly:attribute:weather" || key.endsWith(":weather")) return 1;
  if (key.endsWith(":resolution")) return 2;
  if (key === "poly:collection") return 3;
  if (key.startsWith("poly:attribute:")) return 4;
  return 5;
}

const FACET_GROUPS = [
  { key: "biome", label: "Biome" },
  { key: "region", label: "Region" },
  { key: "resolution", label: "Resolution" },
  { key: "color", label: "Color" },
  { key: "environment", label: "Environment" },
  { key: "theme", label: "Theme" }
] as const;

interface MegaItem {
  provider: "megascans";
  key: string;
  hit: CatalogHit;
}

interface PoliItem {
  provider: "poliigon";
  key: string;
  hit: PoliigonAssetSummary;
}

interface PolyHavenItem {
  provider: "polyhaven";
  key: string;
  hit: PolyHavenAssetSummary;
}

interface PublicItem { provider: "public"; key: string; hit: PublicAssetSummary }
type UnifiedItem = MegaItem | PoliItem | PolyHavenItem | PublicItem;

const SORTS: Array<{ value: AllSort; label: string }> = [
  { value: "relevance", label: "Sort: Relevance" },
  { value: "name", label: "Name A–Z" },
  { value: "type", label: "Asset type" },
  { value: "size", label: "Physical size · largest" },
  { value: "resolution", label: "Resolution · highest" },
  { value: "triangles", label: "Triangles · most" },
  { value: "maps", label: "Texture maps · most" }
];

interface AllSavedSearch {
  id: string;
  name: string;
  query: string;
  allType: string;
  stateFilter: AllStateFilter;
  sort: AllSort;
  sizeFilter: "any" | "small" | "medium" | "large" | "huge";
  megaFacets: Record<string, string[]>;
  poliResolutions: string[];
  poliCreationMethods: string[];
  poliMapTypes: string[];
  poliWeather?: string[];
  polyResolutions?: string[];
  polyMapTypes?: string[];
  polyCategories?: string[];
  polyCollections?: string[];
  polyAttributes?: Record<string, string[]>;
  poliTimeStart?: number | null;
  poliTimeEnd?: number | null;
  /** Provider-specific facets for ambientCG, BlenderKit and OpenHDRI. */
  publicQueries?: Partial<Record<PublicProviderId, Partial<PublicCatalogQuery>>>;
  /** Legacy single-centre saved searches, migrated to a ±3 h window. */
  poliTimeCenter?: number | null;
}

const ALL_SAVED_KEY = "openbridge.allSavedSearches";

function loadAllSavedSearches(): AllSavedSearch[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(ALL_SAVED_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is AllSavedSearch =>
      item && typeof item.id === "string" && typeof item.name === "string" &&
      typeof item.query === "string" && typeof item.allType === "string" &&
      ["all", "free", "favorites", "downloaded"].includes(item.stateFilter) &&
      SORTS.some(sort => sort.value === item.sort) &&
      ["any", "small", "medium", "large", "huge"].includes(item.sizeFilter) &&
      item.megaFacets && typeof item.megaFacets === "object" &&
      Array.isArray(item.poliResolutions) && Array.isArray(item.poliCreationMethods) &&
      Array.isArray(item.poliMapTypes) &&
      (item.poliWeather === undefined || Array.isArray(item.poliWeather)) &&
      (item.polyResolutions === undefined || Array.isArray(item.polyResolutions)) &&
      (item.polyMapTypes === undefined || Array.isArray(item.polyMapTypes)) &&
      (item.polyCategories === undefined || Array.isArray(item.polyCategories)) &&
      (item.polyCollections === undefined || Array.isArray(item.polyCollections)) &&
      (item.polyAttributes === undefined || (typeof item.polyAttributes === "object" && item.polyAttributes !== null))
    ).slice(0, 20);
  } catch {
    return [];
  }
}

function persistAllSavedSearches(searches: AllSavedSearch[]): void {
  try {
    localStorage.setItem(ALL_SAVED_KEY, JSON.stringify(searches));
  } catch {
    // ignore
  }
}

function titleCase(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map(word => word.toLowerCase() === "3d" ? "3D" : word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function megaKey(hit: CatalogHit): string {
  return `megascans:${hitId(hit)}`;
}

function poliKey(hit: PoliigonAssetSummary): string {
  return `poliigon:${hit.id}`;
}

function polyHavenKey(hit: PolyHavenAssetSummary): string {
  return `polyhaven:${hit.id}`;
}

function poliigonSizeMeters(hit: PoliigonAssetSummary): number | null {
  const size = hit.physicalSizeCm;
  if (!size) return null;
  const values = [size.width, size.height, size.depth].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  return values.length > 0 ? Math.max(...values) / 100 : null;
}

function bucketRecord(buckets: Array<{ value: string; count: number }> | undefined): Record<string, number> {
  return Object.fromEntries((buckets ?? []).map(bucket => [bucket.value, bucket.count]));
}

function itemTypeLabel(item: UnifiedItem): string {
  if (item.provider === "megascans") return typeLabel(item.hit.type);
  return assetTypeLabel(item.hit.typeLabel);
}

function itemName(item: UnifiedItem): string {
  return item.hit.name;
}

function itemSearchMatch(item: UnifiedItem): SearchMatch {
  const typeLabelValue = itemTypeLabel(item);
  if (item.provider === "megascans") {
    const hit = item.hit;
    return {
      name: hit.name,
      typeLabel: typeLabelValue,
      tags: [hit.asset_type, hit.category, hit.subCategory, hit.subCategory2, hit.subCategory3, hit.biome, hit.region, hit.physicalSize]
        .filter((value): value is string => Boolean(value)),
      categories: [...(hit.tags ?? []), ...(hit._tags ?? []), ...(hit.categories ?? []), ...(hit.assetCategories ?? [])]
    };
  }
  if (item.provider === "poliigon") {
    return {
      name: item.hit.name,
      typeLabel: typeLabelValue,
      tags: [...item.hit.tags, item.hit.assetName],
      categories: item.hit.categories
    };
  }
  if (item.provider === "polyhaven") {
    return {
      name: item.hit.name,
      typeLabel: typeLabelValue,
      tags: item.hit.tags,
      categories: [...item.hit.categories, item.hit.category, ...item.hit.collections]
    };
  }
  return {
    name: item.hit.name,
    typeLabel: typeLabelValue,
    tags: item.hit.tags,
    categories: [...item.hit.categories, item.hit.category]
  };
}

function itemPopularity(item: UnifiedItem): number | null {
  if (item.provider === "megascans") return typeof item.hit.points === "number" ? item.hit.points : null;
  if (item.provider === "poliigon") return null;
  return item.hit.downloadCount;
}

function itemFree(item: UnifiedItem): boolean {
  if (item.provider === "megascans") return item.hit.points === 0;
  if (item.provider === "poliigon") return item.hit.free;
  if (item.provider === "polyhaven") return true;
  return item.hit.free;
}

function itemResolution(item: UnifiedItem): number | null {
  if (item.provider === "megascans") {
    return item.hit.metadata?.technical?.resolution ?? item.hit.resolution ?? null;
  }
  return item.hit.maxResolution;
}

function itemTriangles(item: UnifiedItem): number | null {
  if (item.provider === "public" && item.hit.provider === "blenderkit") return null;
  if (item.provider === "megascans") return item.hit.metadata?.technical?.maxTris ?? null;
  if (item.provider === "polyhaven" || item.provider === "public") return item.hit.polycount;
  return item.hit.maxTris;
}

function itemMaps(item: UnifiedItem): number | null {
  if (item.provider === "megascans") return item.hit.metadata?.technical?.mapCount ?? null;
  return item.hit.mapCodes.length;
}

function itemSize(item: UnifiedItem): number | null {
  if (item.provider === "megascans") {
    return typeof item.hit.maxSize === "number"
      ? item.hit.maxSize
      : typeof item.hit.minSize === "number"
        ? item.hit.minSize
        : null;
  }
  if (item.provider === "polyhaven" || item.provider === "public") {
    const dimensions = item.hit.dimensionsMm;
    return dimensions && dimensions.length > 0 ? Math.max(...dimensions) / 1000 : null;
  }
  return poliigonSizeMeters(item.hit);
}

export function AllView() {
  const publicStates = usePublicStore(state => state.providers);
  const publicFavorites = usePublicStore(state => state.favorites);
  const blenderkitAuth = usePublicStore(state => state.blenderkit);
  const publicMetadataReady = PUBLIC_PROVIDER_IDS.map(provider => String(publicStates[provider].metadataReady)).join(":");
  const density = useStore(state => state.density);
  const packs = useStore(state => state.packs);
  const allType = useStore(state => state.allType);
  const allStateFilter = useStore(state => state.allStateFilter);
  const publicFavoritesVersion = allStateFilter === "favorites" ? publicFavorites.join("|") : "";
  const allSort = useStore(state => state.allSort);
  const sizeFilter = useStore(state => state.sizeFilter);
  const setAllType = useStore(state => state.setAllType);
  const setAllStateFilter = useStore(state => state.setAllStateFilter);
  const setAllSort = useStore(state => state.setAllSort);
  const query = useStore(state => state.query);
  const megaHits = useStore(state => state.hits);
  const megaTotal = useStore(state => state.nbHits);
  const megaLoading = useStore(state => state.catalogLoading);
  const megaError = useStore(state => state.catalogError);
  const megaHasMore = useStore(state => state.hasMore);
  const megaFacets = useStore(state => state.facets);
  const megaFacetFilters = useStore(state => state.facetFilters);
  const megaFavorites = useStore(state => state.favorites);
  const megaAcquired = useStore(state => state.acquired);
  const megaLocalRefs = useStore(state => state.localRefs);
  const downloads = useStore(state => state.downloads);
  const auth = useStore(state => state.auth);
  const login = useStore(state => state.login);
  const disabledProviders = useStore(state => state.disabledProviders);
  const toggleProviderEnabled = useStore(state => state.toggleProviderEnabled);
  const enableAllProviders = useStore(state => state.enableAllProviders);
  const megaEnabled = !disabledProviders.includes("megascans");
  const poliEnabled = !disabledProviders.includes("poliigon");
  const polyEnabled = !disabledProviders.includes("polyhaven");
  const publicEnabled = PUBLIC_PROVIDER_IDS.filter(provider => !disabledProviders.includes(provider));

  const poliHits = usePoliigonStore(state => state.hits);
  const poliTotal = usePoliigonStore(state => state.total);
  const poliLoading = usePoliigonStore(state => state.loading);
  const poliError = usePoliigonStore(state => state.error);
  const poliHasMore = usePoliigonStore(state => state.hasMore);
  const poliFacets = usePoliigonStore(state => state.facets);
  const poliStatus = usePoliigonStore(state => state.status);
  const poliAuth = usePoliigonStore(state => state.auth);
  const poliOwned = usePoliigonStore(state => state.owned);
  const poliFavorites = usePoliigonStore(state => state.favorites);
  const poliLocal = usePoliigonStore(state => state.localById);
  const poliCategories = usePoliigonStore(state => state.categories);
  const poliResolutions = usePoliigonStore(state => state.resolutions);
  const poliCreationMethods = usePoliigonStore(state => state.creationMethods);
  const poliMapTypes = usePoliigonStore(state => state.mapTypes);
  const poliWeather = usePoliigonStore(state => state.weather);
  const togglePoliWeather = usePoliigonStore(state => state.toggleWeather);
  const poliTimeStart = usePoliigonStore(state => state.timeStart);
  const poliTimeEnd = usePoliigonStore(state => state.timeEnd);
  const setTimeRange = usePoliigonStore(state => state.setTimeRange);
  const openPoliigonLogin = usePoliigonStore(state => state.openLogin);
  const refreshPoliigon = usePoliigonStore(state => state.refresh);

  const polyHits = usePolyHavenStore(state => state.hits);
  const polyTotal = usePolyHavenStore(state => state.total);
  const polyLoadingState = usePolyHavenStore(state => state.loading);
  const polyError = usePolyHavenStore(state => state.error);
  const polyHasMore = usePolyHavenStore(state => state.hasMore);
  const polyFacets = usePolyHavenStore(state => state.facets);
  const polyStatus = usePolyHavenStore(state => state.status);
  const polyFavorites = usePolyHavenStore(state => state.favorites);
  const polyLocal = usePolyHavenStore(state => state.localById);
  const polyCategories = usePolyHavenStore(state => state.categoriesFilter);
  const polyResolutions = usePolyHavenStore(state => state.resolutions);
  const polyMapTypes = usePolyHavenStore(state => state.mapTypes);
  const polyCollections = usePolyHavenStore(state => state.collections);
  const polyAttributeFilters = usePolyHavenStore(state => state.attributeFilters);
  const togglePolyAttribute = usePolyHavenStore(state => state.toggleAttribute);
  const polyTimeStart = usePolyHavenStore(state => state.timeStart);
  const polyTimeEnd = usePolyHavenStore(state => state.timeEnd);
  const refreshPolyHaven = usePolyHavenStore(state => state.refresh);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listView, setListView] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [pointsByKey, setPointsByKey] = useState<Map<string, number | undefined>>(() => new Map());
  const [selectingAll, setSelectingAll] = useState(false);
  const [activeGroup, setActiveGroup] = useState("mega:biome");
  const [savedSearches, setSavedSearches] = useState<AllSavedSearch[]>(loadAllSavedSearches);
  const anchor = useRef<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrollKey = JSON.stringify({
    query,
    allType,
    allStateFilter,
    allSort,
    sizeFilter,
    megaFacetFilters,
    poliResolutions,
    poliCreationMethods,
    poliMapTypes,
    poliWeather,
    polyResolutions,
    polyMapTypes,
    polyCategories,
    polyCollections
  });
  useBrowseScroll(bodyRef, "discover", scrollKey, {
    loaded: !megaLoading && !poliLoading,
    scope: "all"
  });

  const typeOptions = useMemo(() => [
    { value: "", label: "All content" },
    ...ALL_SOURCE_TREE.map(node => ({ value: node.value, label: node.label }))
  ], []);
  // The type control stays at the top-level type; the category tree and the
  // active-filter chip carry the selected subcategory.
  const typeValue = allType.includes(":") ? allType.split(":")[0] : allType;

  useEffect(() => {
    // Entering the combined view re-applies the cross-provider type and state filters
    // to both stores and establishes the same query on each side.
    useStore.getState().syncAllSources();
  }, []);
  useEffect(() => {
    for (const provider of PUBLIC_PROVIDER_IDS) {
      if (!publicEnabled.includes(provider)) continue;
      const state = usePublicStore.getState();
      // Subcategory mappings are deliberately conservative until verified against each taxonomy.
      const category = publicCategoryQuery(provider, allType, state.providers[provider].categories);
      const start = polyTimeStart ?? poliTimeStart;
      const end = polyTimeEnd ?? poliTimeEnd;
      const bounds = allType.startsWith("hdri") ? null : sizeBounds(sizeFilter);
      const range = bounds ? { min: bounds.minSize, max: bounds.maxSize } : null;
      const unsupported = provider === "blenderkit" && (start !== null && end !== null || sizeFilter !== "any");
      void state.search(provider, true, { ...category, ...(unsupported ? { types: ["__none__"] } : {}), minSize: range?.min ?? undefined, maxSize: range?.max ?? undefined, timeStart: start ?? category.timeStart, timeEnd: end ?? category.timeEnd, query, freeOnly: allStateFilter === "free", ids: allStateFilter === "favorites" ? publicFavorites.filter(key => key.startsWith(`${provider}:`)).map(key => key.slice(provider.length + 1)) : allStateFilter === "downloaded" ? megaLocalRefs.filter(ref => ref.id.startsWith(`${provider}:`)).map(ref => ref.id.slice(provider.length + 1)) : undefined });
    }
  }, [query, allType, allStateFilter, megaLocalRefs, publicFavoritesVersion, sizeFilter, poliTimeStart, poliTimeEnd, polyTimeStart, polyTimeEnd, publicMetadataReady, disabledProviders]);

  useEffect(() => {
    // Poliigon category paths become IDs only after the category tree loads.
    useStore.getState().syncAllSources();
  }, [poliCategories]);

  useEffect(() => {
    setSelectedKeys(new Set());
    setPointsByKey(new Map());
    anchor.current = null;
  }, [query, allType, allStateFilter, allSort, disabledProviders]);

  const megaOwned = useMemo(() => new Set(megaAcquired), [megaAcquired]);
  const megaLocal = useMemo(
    () => new Map(megaLocalRefs.map(ref => [ref.id, ref.path])),
    [megaLocalRefs]
  );
  const poliOwnedSet = useMemo(() => new Set(poliOwned), [poliOwned]);
  const megaFavoriteSet = useMemo(() => new Set(megaFavorites), [megaFavorites]);
  const poliFavoriteSet = useMemo(() => new Set(poliFavorites), [poliFavorites]);
  const polyFavoriteSet = useMemo(() => new Set(polyFavorites), [polyFavorites]);

  const merged = useMemo<UnifiedItem[]>(() => {
    const mega: UnifiedItem[] = megaEnabled ? megaHits.map(hit => ({
      provider: "megascans",
      key: megaKey(hit),
      hit
    })) : [];
    const poli: UnifiedItem[] = poliEnabled ? poliHits.map(hit => ({
      provider: "poliigon",
      key: poliKey(hit),
      hit
    })) : [];
    const poly: UnifiedItem[] = polyEnabled ? polyHits.map(hit => ({
      provider: "polyhaven",
      key: polyHavenKey(hit),
      hit
    })) : [];
    const additional: UnifiedItem[] = publicEnabled.flatMap(provider => publicStates[provider].hits.map(hit => ({ provider: "public" as const, key: publicJobId(provider, hit.id), hit })));
    const groups: Array<{ provider: string; items: UnifiedItem[] }> = [
      { provider: "megascans", items: mega },
      { provider: "poliigon", items: poli },
      { provider: "polyhaven", items: poly },
      ...publicEnabled.map(provider => ({
        provider,
        items: publicStates[provider].hits.map(hit => ({
          provider: "public" as const,
          key: publicJobId(provider, hit.id),
          hit
        }))
      }))
    ];
    let items: UnifiedItem[];
    if (allSort === "relevance") {
      if (query.trim()) {
        // Rank across providers instead of taking turns: the first page should
        // contain the best matches regardless of which catalogue owns them.
        items = rankSearchEntries(query, groups.flatMap(group => group.items.map((item, groupIndex) => ({
          item,
          provider: group.provider,
          groupIndex,
          match: itemSearchMatch(item),
          popularity: itemPopularity(item),
          free: itemFree(item)
        }))));
      } else {
        items = [];
        const length = Math.max(mega.length, poli.length, poly.length, additional.length);
        for (let index = 0; index < length; index += 1) {
          if (mega[index]) items.push(mega[index]);
          if (poli[index]) items.push(poli[index]);
          if (poly[index]) items.push(poly[index]);
          if (additional[index]) items.push(additional[index]);
        }
      }
    } else {
      items = [...mega, ...poli, ...poly, ...additional];
    }
    if (allSort === "name") {
      return items.sort((a, b) => itemName(a).localeCompare(itemName(b)));
    }
    if (allSort === "type") {
      return items.sort((a, b) =>
        itemTypeLabel(a).localeCompare(itemTypeLabel(b)) || itemName(a).localeCompare(itemName(b))
      );
    }
    if (allSort === "relevance") return items;
    const numeric: Record<string, (item: UnifiedItem) => number | null> = {
      size: itemSize,
      resolution: itemResolution,
      triangles: itemTriangles,
      maps: itemMaps
    };
    const get = numeric[allSort];
    return items.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av === null) return bv === null ? itemName(a).localeCompare(itemName(b)) : 1;
      if (bv === null) return -1;
      return bv - av || itemName(a).localeCompare(itemName(b));
    });
  }, [allSort, megaHits, poliHits, polyHits, publicStates, query, megaEnabled, poliEnabled, polyEnabled, disabledProviders]);

  const total = (megaEnabled ? megaTotal : 0) + (poliEnabled ? poliTotal : 0) + (polyEnabled ? polyTotal : 0)
    + publicEnabled.reduce((sum, provider) => sum + publicStates[provider].total, 0);
  const loading = megaEnabled && megaLoading || poliEnabled && poliLoading || polyEnabled && polyLoadingState
    || publicEnabled.some(provider => publicStates[provider].loading);
  const hasMore = megaEnabled && megaHasMore || poliEnabled && poliHasMore || polyEnabled && polyHasMore
    || publicEnabled.some(provider => publicStates[provider].hasMore);
  const typeOption = allSourceCategory(allType);
  const rootType = allType.split(":")[0];
  const isHdri = allType === "hdri" || allType.startsWith("hdri:");
  const allowSize = !isHdri && !["atlas", "brush", "decal", "imperfection", "displacement"].includes(rootType);
  const allowTriangles = allType === "" || rootType === "3d" || rootType === "plant";
  const allowMaps = !isHdri && !["brush", "imperfection", "displacement"].includes(rootType);
  const sortOptions = useMemo(
    () => SORTS.filter(option => {
      if (option.value === "size") return allowSize;
      if (option.value === "triangles") return allowTriangles;
      if (option.value === "maps") return allowMaps;
      if (option.value === "type") return allType === "";
      return true;
    }),
    [allowSize, allowTriangles, allowMaps, allType]
  );

  useEffect(() => {
    if (!sortOptions.some(option => option.value === allSort)) setAllSort("relevance");
  }, [allSort, sortOptions, setAllSort]);

  useEffect(() => {
    if (!allowSize && sizeFilter !== "any") {
      useStore.setState({ sizeFilter: "any" });
      void useStore.getState().syncAllSources();
    }
  }, [allowSize, sizeFilter]);
  const poliReady = poliStatus?.state === "ready";
  const poliIndexing = poliEnabled && (poliStatus?.state === "refreshing" || (!poliReady && poliLoading));
  const poliUnavailable = poliEnabled && !poliReady && !poliIndexing && poliStatus?.state !== "error";
  const polyReady = polyStatus?.state === "ready";
  const polyIndexing = polyEnabled && (polyStatus?.state === "refreshing" || (!polyReady && polyLoadingState));
  const polyUnavailable = polyEnabled && !polyReady && !polyIndexing && polyStatus?.state !== "error";
  const publicIndexing = publicEnabled.filter(provider => provider !== "blenderkit" && publicStates[provider].status?.state === "refreshing");
  const publicUnindexed = publicEnabled.filter(provider => provider !== "blenderkit" && publicStates[provider].status !== null && !publicStates[provider].loading && !publicStates[provider].error && publicStates[provider].hits.length === 0 && (!publicStates[provider].status?.count || publicStates[provider].status?.state === "empty"));
  const favoriteCount = megaFavorites.length + poliFavorites.length + polyFavorites.length + publicFavorites.length;
  const megaDownloadedCount = megaLocalRefs.filter(ref => !ref.id.startsWith("poliigon:") && !ref.id.startsWith("polyhaven:") && !parsePublicJobId(ref.id)).length;
  const downloadedCount = megaDownloadedCount + Object.keys(poliLocal).length + Object.keys(polyLocal).length + megaLocalRefs.filter(ref => Boolean(parsePublicJobId(ref.id))).length;

  const megaFacetCount = megaEnabled ? Object.values(megaFacetFilters).reduce((sum, values) => sum + values.length, 0) : 0;
  const poliFacetCount = poliEnabled ? poliResolutions.length + poliCreationMethods.length + poliMapTypes.length + poliWeather.length : 0;
  const polyFacetCount = polyEnabled ? polyResolutions.length + polyMapTypes.length + polyCategories.length + polyCollections.length : 0;
  const polyAttributeCount = polyEnabled ? Object.values(polyAttributeFilters).reduce((sum, values) => sum + values.length, 0) : 0;
  const publicFacetCount = publicEnabled.reduce((sum, provider) => {
    const query = publicStates[provider].query;
    return sum + (query.licenses?.length ?? 0) + (query.resolutions?.length ?? 0) + (query.mapTypes?.length ?? 0) + (query.modelFormats?.length ?? 0) + (query.weather?.length ?? 0) + (query.tags?.length ?? 0)
      + (query.minResolution !== undefined ? 1 : 0) + (query.maxTris !== undefined ? 1 : 0)
      + (query.minBytes !== undefined ? 1 : 0) + (query.maxBytes !== undefined ? 1 : 0)
      + (query.timeWindows?.length ?? 0);
  }, 0);
  const activeFacetCount = megaFacetCount + poliFacetCount + polyFacetCount + polyAttributeCount + publicFacetCount;

  const togglePublicFacet = (provider: typeof PUBLIC_PROVIDER_IDS[number], field: "licenses" | "resolutions" | "mapTypes" | "modelFormats" | "weather", value: string): void => {
    const current = publicStates[provider].query[field] ?? [];
    const next = current.includes(value) ? current.filter(entry => entry !== value) : [...current, value];
    void usePublicStore.getState().search(provider, true, { [field]: next } as Partial<import("../../shared/public-providers").PublicCatalogQuery>);
  };
  const publicChips = (): ReactElement[] => publicEnabled.flatMap(provider => {
    const query = publicStates[provider].query;
    const chips: ReactElement[] = [];
    const add = (field: "licenses" | "resolutions" | "mapTypes" | "modelFormats" | "weather" | "tags", value: string) => chips.push(
      <button type="button" key={`public:${provider}:${field}:${value}`} className="facet-chip active" onClick={() => field === "tags" ? void usePublicStore.getState().search(provider, true, { tags: (query.tags ?? []).filter(entry => entry !== value) }) : togglePublicFacet(provider, field, value)}>
        <span>{publicProviderLabel(provider)} {field === "mapTypes" ? "map" : field === "modelFormats" ? "format" : field === "weather" ? "sky" : field}</span>
        <strong>{field === "weather" ? skyConditionLabel(value) : field === "mapTypes" ? poliigonMapName(value) : field === "resolutions" || field === "modelFormats" ? value.toUpperCase() : value}</strong>
        <em aria-hidden="true">×</em>
      </button>
    );
    for (const field of ["licenses", "resolutions", "mapTypes", "modelFormats", "weather", "tags"] as const) {
      for (const value of query[field] ?? []) add(field, value);
    }
    if (query.minResolution !== undefined) chips.push(<button type="button" key={`public:${provider}:minres`} className="facet-chip active" onClick={() => void usePublicStore.getState().search(provider, true, { minResolution: undefined })}><span>{publicProviderLabel(provider)} min resolution</span><strong>{query.minResolution / 1024}K</strong><em aria-hidden="true">×</em></button>);
    if (query.maxTris !== undefined) chips.push(<button type="button" key={`public:${provider}:maxtris`} className="facet-chip active" onClick={() => void usePublicStore.getState().search(provider, true, { maxTris: undefined })}><span>{publicProviderLabel(provider)} max polygons</span><strong>{query.maxTris.toLocaleString()}</strong><em aria-hidden="true">×</em></button>);
    if (query.minBytes !== undefined) chips.push(<button type="button" key={`public:${provider}:minbytes`} className="facet-chip active" onClick={() => void usePublicStore.getState().search(provider, true, { minBytes: undefined })}><span>{publicProviderLabel(provider)} min size</span><strong>{(query.minBytes / 1048576).toFixed(1)} MB</strong><em aria-hidden="true">×</em></button>);
    if (query.maxBytes !== undefined) chips.push(<button type="button" key={`public:${provider}:maxbytes`} className="facet-chip active" onClick={() => void usePublicStore.getState().search(provider, true, { maxBytes: undefined })}><span>{publicProviderLabel(provider)} max size</span><strong>{(query.maxBytes / 1048576).toFixed(1)} MB</strong><em aria-hidden="true">×</em></button>);
    return chips;
  });

  const publicFacetGroups = (): FilterGroup[] => publicEnabled.flatMap(provider => {
    const state = publicStates[provider];
    const groups: FilterGroup[] = [];
    const add = (field: "licenses" | "resolutions" | "mapTypes" | "modelFormats" | "weather", label: string, buckets: Array<{ value: string; count: number }>, labels?: Record<string, string>) => {
      const selected = state.query[field] ?? [];
      if (!buckets.length && !selected.length) return;
      const values = bucketRecord(buckets);
      for (const value of selected) values[value] ??= 0;
      groups.push({
        key: `public:${provider}:${field}`,
        label: `${publicProviderLabel(provider)} · ${label}${state.facets?.sampleFacets ? " (sample)" : ""}`,
        values,
        selected,
        toggle: value => togglePublicFacet(provider, field, value),
        showCounts: !state.facets?.sampleFacets,
        ...(labels ? { labels } : {})
      });
    };
    add("licenses", "Licence", state.facets?.licenses ?? [], Object.fromEntries((state.facets?.licenses ?? []).map(bucket => [bucket.value, bucket.value])));
    if (provider !== "blenderkit") {
      add("resolutions", "Resolution", state.facets?.resolutions ?? [], Object.fromEntries((state.facets?.resolutions ?? []).map(bucket => [bucket.value, bucket.value.toUpperCase()])));
      add("mapTypes", "Texture maps", state.facets?.mapTypes ?? [], Object.fromEntries((state.facets?.mapTypes ?? []).map(bucket => [bucket.value, poliigonMapName(bucket.value)])));
      if (isHdri) add("weather", "Sky condition", [...(state.facets?.weather ?? [])].sort((a, b) => skyConditionRank(a.value) - skyConditionRank(b.value)), Object.fromEntries((state.facets?.weather ?? []).map(bucket => [bucket.value, skyConditionLabel(bucket.value)])));
      add("modelFormats", "Model format", state.facets?.modelFormats ?? []);
    }
    return groups;
  });
  const timeStart = polyTimeStart ?? poliTimeStart;
  const timeEnd = polyTimeEnd ?? poliTimeEnd;
  const hasTimeFilter = isHdri && timeStart != null && timeEnd != null;
  const polyAttributeType = isHdri
    ? "hdris"
    : rootType === "surface" || rootType === "atlas"
      ? "textures"
      : rootType === "3d" || rootType === "plant"
        ? "models"
        : null;

  const setHdriTimeRange = (start: number | null, end: number | null): void => {
    setTimeRange(start, end);
    usePolyHavenStore.getState().setTimeRange(start, end);
  };

  const restrictedMegaGroups = ["atlas", "brush", "decal", "imperfection", "displacement"].includes(rootType);
  const allowedMegaFacets = restrictedMegaGroups
    ? new Set(["resolution", "color", "theme"])
    : null;
  const poliResolutionBuckets = sortResolutionBuckets(poliFacets?.resolutions ?? []);
  const polyResolutionBuckets = sortResolutionBuckets(polyFacets?.resolutions ?? []);
  const poliMapBuckets = sortBucketsBy(poliFacets?.mapTypes ?? [], poliigonMapRank);
  const polyMapBuckets = sortBucketsBy(polyFacets?.mapTypes ?? [], polyHavenMapRank);
  const filterGroups: FilterGroup[] = [
    ...(isHdri ? [] : FACET_GROUPS.filter(group => !allowedMegaFacets || allowedMegaFacets.has(group.key)).map(group => ({
      key: `mega:${group.key}`,
      label: `Megascans · ${group.label}`,
      values: group.key === "resolution"
        ? sortResolutionRecord(megaFacets[group.key] ?? {})
        : megaFacets[group.key] ?? {},
      selected: megaFacetFilters[group.key] ?? [],
      toggle: (value: string) => useStore.getState().toggleFacet(group.key, value),
      ...(group.key === "resolution"
        ? { compare: (a: string, b: string) => resolutionFacetValue(a) - resolutionFacetValue(b) }
        : { labels: Object.fromEntries(Object.keys(megaFacets[group.key] ?? {}).map(value => [value, titleCase(value)])) })
    }))),
    {
      key: "poli:resolution",
      label: "Poliigon · Resolution",
      values: bucketRecord(poliResolutionBuckets),
      selected: poliResolutions,
      toggle: (value: string) => usePoliigonStore.getState().toggleResolution(value),
      compare: (a: string, b: string) => resolutionFacetValue(a) - resolutionFacetValue(b)
    },
    ...(isHdri ? [{
      key: "poli:weather",
      label: "Poliigon · Sky condition",
      values: bucketRecord([...(poliFacets?.weather ?? [])].sort(
        (a, b) => skyConditionRank(a.value) - skyConditionRank(b.value)
      )),
      selected: poliWeather,
      toggle: togglePoliWeather,
      labels: Object.fromEntries((poliFacets?.weather ?? []).map(bucket => [bucket.value, skyConditionLabel(bucket.value)])),
      compare: (a: string, b: string) => skyConditionRank(a) - skyConditionRank(b)
    }] : []),
    {
      key: "poly:resolution",
      label: "Poly Haven · Resolution",
      values: bucketRecord(polyResolutionBuckets),
      selected: polyResolutions,
      toggle: (value: string) => usePolyHavenStore.getState().toggleResolution(value),
      labels: Object.fromEntries(polyResolutionBuckets.map(bucket => [bucket.value, bucket.value.toUpperCase()])),
      compare: (a: string, b: string) => resolutionFacetValue(a) - resolutionFacetValue(b)
    },
    ...(isHdri ? [] : [
      {
        key: "poli:creation",
        label: "Poliigon · Creation method",
        values: bucketRecord(poliFacets?.creationMethods),
        selected: poliCreationMethods,
        toggle: (value: string) => usePoliigonStore.getState().toggleCreationMethod(value),
        labels: Object.fromEntries((poliFacets?.creationMethods ?? []).map(bucket => [bucket.value, titleCase(bucket.value)]))
      },
      {
        key: "poli:maps",
        label: "Poliigon · Texture maps",
        values: bucketRecord(poliMapBuckets),
        selected: poliMapTypes,
        toggle: (value: string) => usePoliigonStore.getState().toggleMapType(value),
        labels: Object.fromEntries(poliMapBuckets.map(bucket => [bucket.value, poliigonMapName(bucket.value)])),
        compare: (a: string, b: string) => poliigonMapRank(a) - poliigonMapRank(b)
      },
      {
        key: "poly:maps",
        label: "Poly Haven · Texture maps",
        values: bucketRecord(polyMapBuckets),
        selected: polyMapTypes,
        toggle: (value: string) => usePolyHavenStore.getState().toggleMapType(value),
        labels: Object.fromEntries(polyMapBuckets.map(bucket => [bucket.value, polyHavenMapLabel(bucket.value)])),
        compare: (a: string, b: string) => polyHavenMapRank(a) - polyHavenMapRank(b)
      }
    ]),
    ...(isHdri ? [] : [{
      key: "poly:category",
      label: "Poly Haven · Category tags",
      values: bucketRecord(polyFacets?.categories),
      selected: polyCategories,
      toggle: (value: string) => usePolyHavenStore.getState().toggleCategory(value),
      labels: Object.fromEntries((polyFacets?.categories ?? []).map(bucket => [bucket.value, titleCase(bucket.value)]))
    }]),
    {
      key: "poly:collection",
      label: "Poly Haven · Collection",
      values: bucketRecord(polyFacets?.collections),
      selected: polyCollections,
      toggle: (value: string) => usePolyHavenStore.getState().toggleCollection(value),
      labels: Object.fromEntries((polyFacets?.collections ?? []).map(bucket => [bucket.value, titleCase(bucket.value.replace(/^collection:\s*/i, ""))]))
    },
    ...(polyAttributeType
      ? Object.entries(polyFacets?.attributes ?? {})
          .filter(([key, buckets]) => {
            if (key === "time_of_day") return false;
            if (
              key === "weather" &&
              (polyAttributeFilters.environment?.length ?? 0) > 0 &&
              !polyAttributeFilters.environment?.includes("outdoor")
            ) {
              return false;
            }
            const allowed = POLYHAVEN_ATTRIBUTE_TYPES[key];
            return (!allowed || allowed.includes(polyAttributeType as "hdris" | "textures" | "models")) &&
              (buckets.length > 0 || (polyAttributeFilters[key]?.length ?? 0) > 0);
          })
          .map(([key, buckets]) => {
            let values = key === "weather"
              ? [...buckets].sort((a, b) => skyConditionRank(a.value) - skyConditionRank(b.value))
              : buckets;
            if (key === "environment" && (polyAttributeFilters.weather?.length ?? 0) > 0) {
              values = values.filter(bucket => bucket.value === "outdoor");
            }
            return {
              key: `poly:attribute:${key}`,
              label: `Poly Haven · ${polyHavenAttributeLabel(key)}`,
              values: bucketRecord(values),
              selected: polyAttributeFilters[key] ?? [],
              toggle: (value: string) => togglePolyAttribute(key, value),
              labels: Object.fromEntries(values.map(bucket => [bucket.value, polyHavenAttributeValue(bucket.value)]))
            };
          })
      : []),
    ...publicFacetGroups()
  ].filter(group => {
    if (group.key.startsWith("mega:")) return megaEnabled;
    if (group.key.startsWith("poli:")) return poliEnabled;
    if (group.key.startsWith("poly:")) return polyEnabled;
    if (group.key.startsWith("public:")) return publicEnabled.includes(group.key.split(":")[1] as PublicProviderId);
    return true;
  }).filter(group => Object.keys(group.values).length > 0 || group.selected.length > 0);
  const orderedFilterGroups = isHdri
    ? [...filterGroups].sort((a, b) => hdriFilterRank(a.key) - hdriFilterRank(b.key))
    : filterGroups;

  useEffect(() => {
    if (filterGroups.length === 0 && activeFacetCount === 0 && filtersOpen) setFiltersOpen(false);
  }, [filterGroups.length, activeFacetCount, filtersOpen]);

  const loadMore = (): void => {
    for (const provider of publicEnabled) if (publicStates[provider].hasMore) void usePublicStore.getState().search(provider, false);
    if (megaEnabled && megaHasMore) void useStore.getState().search(false);
    if (poliEnabled && poliHasMore) void usePoliigonStore.getState().loadMore();
    if (polyEnabled && polyHasMore) void usePolyHavenStore.getState().loadMore();
  };

  const quickPublicDownload = async (hit: PublicAssetSummary): Promise<void> => {
    if (hit.provider === "blenderkit" && !blenderkitAuth.hasKey) {
      useStore.getState().toast("Add a BlenderKit API key in Settings before downloading.", true);
      return;
    }
    if (hit.provider === "blenderkit" && hit.attributes.canDownload === false) {
      useStore.getState().toast("BlenderKit account or plan required; OpenBridge does not purchase assets.", true);
      return;
    }
    if (hit.provider === "openhdri" && !window.confirm("Download the published original EXR? OpenHDRI currently serves 16K files that can exceed 1 GB.")) return;
    try { await window.openbridge.downloads.start(hit.id, undefined, hit.provider); useStore.getState().toast(`Queued ${hit.name}`); }
    catch (error) { useStore.getState().toast(String(error), true); }
  };

  const openItem = (item: UnifiedItem): void => {
    anchor.current = item.key;
    usePublicStore.getState().close();
    if (item.provider === "public") { useStore.getState().closeSelection(); void usePublicStore.getState().open(item.hit); return; }
    if (item.provider === "megascans") {
      usePoliigonStore.getState().closeAsset();
      usePolyHavenStore.getState().closeAsset();
      void useStore.getState().openHit(item.hit);
    } else if (item.provider === "poliigon") {
      useStore.getState().closeSelection();
      usePolyHavenStore.getState().closeAsset();
      void usePoliigonStore.getState().openAsset(item.hit);
    } else {
      useStore.getState().closeSelection();
      usePoliigonStore.getState().closeAsset();
      void usePolyHavenStore.getState().openAsset(item.hit);
    }
  };

  const toggleSelection = (item: UnifiedItem, event?: { shiftKey: boolean }): void => {
    if (!selectMode && event?.shiftKey) {
      setSelectMode(true);
      setSelectedKeys(new Set());
      setPointsByKey(new Map());
      useStore.getState().closeSelection();
      usePoliigonStore.getState().closeAsset();
      usePolyHavenStore.getState().closeAsset();
    }
    setPointsByKey(previous => {
      const next = new Map(previous);
      next.set(item.key, item.provider === "megascans" ? item.hit.points : undefined);
      return next;
    });
    setSelectedKeys(previous => {
      const next = new Set(previous);
      if (event?.shiftKey && anchor.current) {
        const from = merged.findIndex(entry => entry.key === anchor.current);
        const to = merged.findIndex(entry => entry.key === item.key);
        if (from >= 0 && to >= 0) {
          for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) {
            next.add(merged[index].key);
          }
          return next;
        }
      }
      if (next.has(item.key)) next.delete(item.key);
      else next.add(item.key);
      anchor.current = item.key;
      return next;
    });
  };

  const selectLoaded = (): void => {
    setSelectedKeys(new Set(merged.map(item => item.key)));
    setPointsByKey(new Map(merged.map(item => [
      item.key,
      item.provider === "megascans" ? item.hit.points : undefined
    ])));
  };

  const selectAllFiltered = async (): Promise<void> => {
    if (selectingAll) return;
    setSelectingAll(true);
    try {
      let megaPoints = new Map<string, number | undefined>();
      const providers: Array<{ label: string; load: () => Promise<string[]> }> = [
        ...(megaEnabled ? [{
          label: "Megascans",
          load: async () => {
            const result = await window.openbridge.catalog.ids(catalogFilterQuery(useStore.getState()));
            megaPoints = new Map(result.entries.map(entry => [`megascans:${entry.id}`, entry.points]));
            return result.entries.map(entry => `megascans:${entry.id}`);
          }
        }] : []),
        ...(poliEnabled ? [{ label: "Poliigon", load: async () => (await usePoliigonStore.getState().selectAllIds()).map(id => `poliigon:${id}`) }] : []),
        ...(polyEnabled ? [{ label: "Poly Haven", load: async () => (await usePolyHavenStore.getState().selectAllIds()).map(id => `polyhaven:${id}`) }] : []),
        ...publicEnabled.map(provider => ({
          label: publicProviderLabel(provider),
          load: async () => (await window.openbridge.public.ids(usePublicStore.getState().providers[provider].query)).map(id => publicJobId(provider, id))
        }))
      ];
      const settled = await Promise.allSettled(providers.map(provider => provider.load()));
      if (useStore.getState().disabledProviders !== disabledProviders) return;
      const keys: string[] = [];
      const failures: string[] = [];
      settled.forEach((result, index) => {
        if (result.status === "fulfilled") keys.push(...result.value);
        else failures.push(`${providers[index].label}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
      });
      setSelectedKeys(new Set(keys));
      setPointsByKey(megaPoints);
      const message = failures.length
        ? `Selected ${keys.length.toLocaleString()} asset${keys.length === 1 ? "" : "s"}; ${failures.length} source${failures.length === 1 ? "" : "s"} could not be fully selected.`
        : `Selected ${keys.length.toLocaleString()} asset${keys.length === 1 ? "" : "s"}`;
      useStore.getState().toast(message, failures.length > 0);
    } catch (error) {
      useStore.getState().toast(error instanceof Error ? error.message : String(error), true);
    } finally {
      setSelectingAll(false);
    }
  };

  const downloadSelected = async (): Promise<void> => {
    if (selectedKeys.size === 0) return;
    const megaIds: string[] = [];
    const poliIds: number[] = [];
    const polyIds: string[] = [];
    const publicIds: string[] = [];
    let skipped = 0;
    let keyRequired = false;
    for (const key of selectedKeys) {
      const publicRef = parsePublicJobId(key);
      if (publicRef) {
        if (megaLocal.has(key)) { skipped += 1; continue; }
        const loaded = publicStates[publicRef.provider].hits.find(hit => hit.id === publicRef.id);
        if (publicRef.provider === "blenderkit" && !blenderkitAuth.hasKey) { skipped += 1; keyRequired = true; continue; }
        if (publicRef.provider === "blenderkit" && loaded?.attributes.canDownload === false) { skipped += 1; continue; }
        publicIds.push(key);
        continue;
      }
      if (key.startsWith("megascans:")) {
        const id = key.slice("megascans:".length);
        if (megaLocal.has(id)) { skipped += 1; continue; }
        const points = pointsByKey.get(key);
        if (typeof points === "number" && points > 0 && !megaOwned.has(id)) {
          skipped += 1;
          continue;
        }
        megaIds.push(id);
      } else if (key.startsWith("poliigon:")) {
        const id = Number(key.slice("poliigon:".length));
        if (!Number.isFinite(id) || poliLocal[id]) { skipped += 1; continue; }
        if (!poliAuth.loggedIn) { skipped += 1; continue; }
        const loaded = poliHits.find(hit => hit.id === id);
        const entitled = poliAuth.isUnlimited || poliOwnedSet.has(id) || Boolean(loaded?.free);
        if (!entitled) { skipped += 1; continue; }
        poliIds.push(id);
      } else if (key.startsWith("polyhaven:")) {
        const id = key.slice("polyhaven:".length);
        if (!id || polyLocal[id]) { skipped += 1; continue; }
        polyIds.push(id);
      }
    }
    if (keyRequired) useStore.getState().toast("BlenderKit downloads need an API key in Settings; those assets were skipped.", true);
    if (publicIds.some(id => id.startsWith("openhdri:")) && !window.confirm("Queue OpenHDRI downloads? Its published originals are 16K EXRs and can use many gigabytes.")) return;
    let queued = 0;
    if (
      megaIds.length + poliIds.length + polyIds.length + publicIds.length > 100 &&
      !window.confirm(
        `Queue ${(megaIds.length + poliIds.length + polyIds.length + publicIds.length).toLocaleString()} downloads?\n\nThey can use a lot of disk space and time.`
      )
    ) {
      return;
    }
    if (megaIds.length > 0) {
      if (!auth.loggedIn) {
        useStore.getState().toast("Sign in with Epic to download Megascans assets.", true);
      } else {
        const result = await useStore.getState().downloadMany(megaIds);
        queued += result.queued;
      }
    }
    if (publicIds.length) {
      try { queued += (await window.openbridge.downloads.startMany(publicIds)).queued; }
      catch (error) { useStore.getState().toast(String(error), true); }
    }
    if (poliIds.length > 0) {
      try {
        const result = await window.openbridge.downloads.startMany(
          poliIds.map(id => `poliigon:${id}`),
          {
            resolution: "2K",
            maps: [],
            lods: [],
            nativeMesh: true,
            renderer: "Cycles",
            software: "Blender"
          },
          "poliigon"
        );
        queued += result.queued;
      } catch (error) {
        useStore.getState().toast(error instanceof Error ? error.message : String(error), true);
      }
    }
    if (polyIds.length > 0) {
      try {
        const result = await window.openbridge.downloads.startMany(
          polyIds.map(id => `polyhaven:${id}`),
          { resolution: "2k", format: "hdr" },
          "polyhaven"
        );
        queued += result.queued;
      } catch (error) {
        useStore.getState().toast(error instanceof Error ? error.message : String(error), true);
      }
    }
    if (queued > 0) useStore.getState().toast(`Queued ${queued.toLocaleString()} download${queued === 1 ? "" : "s"}`);
    if (skipped > 0) {
      useStore.getState().toast(
        `${skipped.toLocaleString()} selected asset${skipped === 1 ? " was" : "s were"} already downloaded or not entitled`,
        true
      );
    }
    if (queued > 0) {
      setSelectedKeys(new Set());
      setSelectMode(false);
    }
  };

  const clearFilters = (): void => {
    useStore.getState().clearAllFilters();
  };
  const clearSearchAndFilters = (): void => {
    useStore.getState().setQuery("");
    clearFilters();
  };

  const saveCurrentSearch = (): void => {
    const name =
      query.trim() ||
      allSourceCategory(allType).label ||
      (allStateFilter === "downloaded"
        ? "Downloaded assets"
        : allStateFilter === "favorites"
          ? "Favorites"
          : allStateFilter === "free"
            ? "Free assets"
            : "All assets");
    const next = [
      {
        id: Date.now().toString(36),
        name,
        query,
        allType,
        stateFilter: allStateFilter,
        sort: allSort,
        sizeFilter,
        megaFacets: megaFacetFilters,
        poliResolutions,
        poliCreationMethods,
        poliMapTypes,
        poliWeather,
        polyResolutions,
        polyMapTypes,
        polyCategories,
        polyCollections,
        polyAttributes: polyAttributeFilters,
        poliTimeStart,
        poliTimeEnd,
        publicQueries: Object.fromEntries(PUBLIC_PROVIDER_IDS.map(provider => {
          const providerQuery = publicStates[provider].query;
          return [provider, { ...normalizePublicQuery(provider, providerQuery), ids: undefined }];
        })) as Partial<Record<PublicProviderId, Partial<PublicCatalogQuery>>>
      },
      ...savedSearches
    ].slice(0, 20);
    setSavedSearches(next);
    persistAllSavedSearches(next);
    useStore.getState().toast("Search saved");
  };

  const applySavedSearch = (saved: AllSavedSearch): void => {
    useStore.setState({
      query: saved.query,
      allType: saved.allType,
      allStateFilter: saved.stateFilter,
      allSort: saved.sort,
      sizeFilter: saved.sizeFilter,
      facetFilters: saved.megaFacets
    });
    const legacyCenter = saved.poliTimeCenter;
    const legacyStart = legacyCenter != null ? ((legacyCenter - 3 + 24) % 24) : null;
    const legacyEnd = legacyCenter != null ? ((legacyCenter + 3) % 24) : null;
    usePoliigonStore.setState({
      resolutions: saved.poliResolutions,
      creationMethods: saved.poliCreationMethods,
      mapTypes: saved.poliMapTypes,
      weather: saved.poliWeather ?? [],
      timeStart: saved.poliTimeStart ?? legacyStart,
      timeEnd: saved.poliTimeEnd ?? legacyEnd
    });
    usePolyHavenStore.setState({
      resolutions: saved.polyResolutions ?? [],
      mapTypes: saved.polyMapTypes ?? [],
      categoriesFilter: saved.polyCategories ?? [],
      collections: saved.polyCollections ?? [],
      attributeFilters: saved.polyAttributes ?? {},
      timeStart: saved.poliTimeStart ?? legacyStart,
      timeEnd: saved.poliTimeEnd ?? legacyEnd
    });
    for (const provider of PUBLIC_PROVIDER_IDS) {
      // Persisted searches are untrusted input; validate types, arrays and numeric bounds.
      const savedQuery = saved.publicQueries?.[provider];
      void usePublicStore.getState().search(provider, true, savedQuery ? normalizePublicQuery(provider, savedQuery) : {});
    }
    useStore.getState().syncAllSources();
  };

  const removeSavedSearch = (id: string): void => {
    const next = savedSearches.filter(item => item.id !== id);
    setSavedSearches(next);
    persistAllSavedSearches(next);
  };

  const stateFilterValue: AllStateFilter = allStateFilter;
  const selectedCategory = typeOption.value ? typeOption.label : "All Types";

  return (
    <div className="view discover all-sources-view">
      <div className="view-header discover-toolbar">
        <div className="filter-row catalog-toolbar">
          <Dropdown
            className="filter-select"
            value={typeValue}
            onChange={setAllType}
            ariaLabel="Filter by asset type across all sources"
            options={typeOptions}
          />
          <Dropdown
            className="filter-select"
            value={allSort}
            onChange={value => setAllSort(value as AllSort)}
            ariaLabel="Sort all assets"
            options={sortOptions}
          />
          <Dropdown
            className="filter-select"
            value={stateFilterValue}
            onChange={value => setAllStateFilter(value as AllStateFilter)}
            ariaLabel="Filter by ownership or favorites"
            options={[
              { value: "all", label: "All States" },
              { value: "free", label: "Free" },
              { value: "favorites", label: favoriteCount > 0 ? `Favorites (${favoriteCount})` : "Favorites" },
              { value: "downloaded", label: downloadedCount > 0 ? `Downloaded (${downloadedCount})` : "Downloaded" }
            ]}
          />
          {allowSize && (
            <Dropdown
              className="filter-select"
              value={sizeFilter}
              onChange={value => {
                useStore.setState({ sizeFilter: value as typeof sizeFilter });
                useStore.getState().syncAllSources();
              }}
              ariaLabel="Filter by physical size"
              options={SIZE_FILTER_OPTIONS}
            />
          )}
          <button
            type="button"
            className={selectMode ? "filter-action active" : "filter-action"}
            onClick={() => {
              setSelectMode(value => !value);
              setSelectedKeys(new Set());
            }}
          >
            Select
            {selectedKeys.size > 0 && <span className="filter-count">{selectedKeys.size.toLocaleString()}</span>}
          </button>
          {(filterGroups.length > 0 || activeFacetCount > 0) && (
            <button
              type="button"
              className={filtersOpen ? "filter-action active" : "filter-action"}
              aria-expanded={filtersOpen}
              aria-controls="all-source-filter-panel"
              onClick={() => setFiltersOpen(value => !value)}
            >
              Filters
              {activeFacetCount > 0 && <span className="filter-count">{activeFacetCount}</span>}
              <ChevronDownIcon className={filtersOpen ? "filter-chevron open" : "filter-chevron"} />
            </button>
          )}
          <span
            className="result-count"
            title={`Megascans ${megaTotal.toLocaleString()} · Poliigon ${poliTotal.toLocaleString()} · Poly Haven ${polyTotal.toLocaleString()}`}
          >
            {loading && merged.length === 0 ? "Searching all sources…" : assetCountLabel(total)}
          </span>
          {loading && merged.length > 0 && (
            <span className="result-updating" role="status" aria-live="polite">
              <span className="spinner" aria-hidden="true" />Updating
            </span>
          )}
          <DensityControl />
          {merged.length > 0 && !selectMode && <button type="button" className="text-btn" onClick={() => setListView(value => !value)}>{listView ? "Grid view" : "List / compare view"}</button>}
          <RecentBrowsing />
          {!isHdri && <PackBrowser packs={packs} />}
          <BrowsingMenu label={`Saved searches${savedSearches.length ? ` (${savedSearches.length})` : ""}`}>
            <button type="button" className="text-btn" onClick={saveCurrentSearch}>Save current search</button>
            {savedSearches.map(saved => (
              <div className="saved-search" key={saved.id}>
                <button
                  type="button"
                  className="text-btn"
                  onClick={event => {
                    applySavedSearch(saved);
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                >
                  {saved.name}
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remove ${saved.name}`}
                  onClick={() => removeSavedSearch(saved.id)}
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </BrowsingMenu>
          <BrowsingMenu label="Sources">
            <div className="browse-menu-heading"><strong>Open a focused view</strong></div>
            <button
              type="button"
              className="browse-list-item source-summary"
              onClick={event => {
                useStore.getState().setProvider("megascans");
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span>Megascans</span><strong>{megaTotal.toLocaleString()}</strong>
            </button>
            <button
              type="button"
              className="browse-list-item source-summary"
              onClick={event => {
                useStore.getState().setProvider("poliigon");
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span>Poliigon</span><strong>{poliTotal.toLocaleString()}</strong>
            </button>
            <button
              type="button"
              className="browse-list-item source-summary"
              onClick={event => {
                useStore.getState().setProvider("polyhaven");
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span>Poly Haven</span><strong>{polyTotal.toLocaleString()}</strong>
            </button>
            {PUBLIC_PROVIDER_IDS.map(provider => <button
              key={`focus:${provider}`}
              type="button"
              className="browse-list-item source-summary"
              onClick={event => {
                useStore.getState().setProvider(provider);
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span>{publicProviderLabel(provider)}</span><strong>{publicStates[provider].total.toLocaleString()}</strong>
            </button>)}
            {PUBLIC_PROVIDER_IDS.map(provider => <button
              key={`refresh:${provider}`}
              type="button"
              className="browse-list-item"
              disabled={publicStates[provider].status?.state === "refreshing"}
              onClick={event => {
                void window.openbridge.public.refresh(provider).then(() => usePublicStore.getState().init(provider)).catch(error => useStore.getState().toast(String(error), true));
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span>{publicStates[provider].status?.state === "refreshing" ? `Refreshing ${publicProviderLabel(provider)}…` : provider === "blenderkit" ? "Refresh BlenderKit categories" : `Refresh ${publicProviderLabel(provider)} catalogue`}</span>
            </button>)}
            <button
              type="button"
              className="browse-list-item"
              disabled={poliStatus?.state === "refreshing"}
              onClick={event => {
                void refreshPoliigon();
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span>{poliStatus?.state === "refreshing" ? "Refreshing Poliigon…" : "Refresh Poliigon catalogue"}</span>
            </button>
            <button
              type="button"
              className="browse-list-item"
              disabled={polyStatus?.state === "refreshing"}
              onClick={event => {
                void refreshPolyHaven();
                event.currentTarget.closest("details")?.removeAttribute("open");
              }}
            >
              <span>{polyStatus?.state === "refreshing" ? "Refreshing Poly Haven…" : "Refresh Poly Haven catalogue"}</span>
            </button>
            <p className="hint">This view searches all supported catalogues together. Choose a source to focus the catalogue on it.</p>
          </BrowsingMenu>
        </div>

        <div className="all-source-summary" aria-label="Asset sources">
          <span className="all-source-summary-label">Sources</span>
          {disabledProviders.length > 0 && <button type="button" className="text-btn" onClick={enableAllProviders}>Restore all</button>}
          {([
            ["megascans", "Megascans", megaTotal],
            ["poliigon", "Poliigon", poliTotal],
            ["polyhaven", "Poly Haven", polyTotal],
            ...PUBLIC_PROVIDER_IDS.map(provider => [provider, publicProviderLabel(provider), publicStates[provider].total] as const)
          ] as Array<[AssetProvider, string, number]>).map(([id, label, count]) => {
            const enabled = !disabledProviders.includes(id);
            return <button
              key={id}
              type="button"
              className={`all-source-pill${enabled ? " active" : " disabled"}`}
              aria-pressed={enabled}
              title={`${label} ${enabled ? "enabled" : "disabled"} · click to ${enabled ? "disable" : "enable"}`}
              onClick={() => toggleProviderEnabled(id)}
            >
              <ProviderLogo provider={id} />
              <span>{label}</span>
              <strong>{count.toLocaleString()}</strong>
            </button>;
          })}
        </div>
        {publicEnabled.filter(provider => publicStates[provider].error).map(provider => <p className="error-box" role="alert" key={provider}>{publicProviderLabel(provider)}: {publicStates[provider].error}<button type="button" className="text-btn" onClick={() => void usePublicStore.getState().search(provider)}>Retry</button></p>)}
        {publicEnabled.some(provider => publicStates[provider].metadataReady && publicStates[provider].query.types?.includes("__none__") && !publicTypesForRoot(provider, allType).includes("__none__")) && <p className="hint">Sources without reliable metadata for the selected category or shared filter are excluded, rather than showing unrelated assets.</p>}
        {publicStates.blenderkit.total >= 10000 && <p className="hint">BlenderKit totals are capped by its search API; the combined count is not a complete catalogue size.</p>}

        {isHdri && (
          <TimeOfDaySlider
            value={timeStart != null && timeEnd != null
              ? { start: timeStart, end: timeEnd }
              : null}
            onChange={value => setHdriTimeRange(value?.start ?? null, value?.end ?? null)}
          />
        )}

        <div className="active-filters" aria-label="Active filters">
          {allType && (
            <button type="button" className="facet-chip active" onClick={() => setAllType("")}>
              {selectedCategory} ×
            </button>
          )}
          {allStateFilter !== "all" && (
            <button type="button" className="facet-chip active" onClick={() => setAllStateFilter("all")}>
              {allStateFilter === "free"
                ? "Free"
                : allStateFilter === "downloaded"
                  ? "Downloaded"
                  : "Favorites"} ×
            </button>
          )}
          {sizeFilter !== "any" && (
            <button type="button" className="facet-chip active" onClick={() => {
              useStore.setState({ sizeFilter: "any" });
              useStore.getState().syncAllSources();
            }}>
              Size: {SIZE_FILTER_LABELS[sizeFilter]} ×
            </button>
          )}
          {hasTimeFilter && timeStart != null && timeEnd != null && (
            <button type="button" className="facet-chip active" onClick={() => setHdriTimeRange(null, null)}>
              Time: {formatClockValue(timeStart)}–{formatClockValue(timeEnd)} ×
            </button>
          )}
          {!isHdri && Object.entries(megaFacetFilters).flatMap(([group, values]) => values.map(value => (
            <button
              type="button"
              key={`mega:${group}:${value}`}
              className="facet-chip active"
              onClick={() => useStore.getState().toggleFacet(group, value)}
            >
              <span>{FACET_GROUPS.find(item => item.key === group)?.label ?? titleCase(group)}</span>
              <strong>{titleCase(value)}</strong>
              <em aria-hidden="true">×</em>
            </button>
          )))}
          {poliResolutions.map(value => (
            <button type="button" key={`poli:res:${value}`} className="facet-chip active" onClick={() => usePoliigonStore.getState().toggleResolution(value)}>
              <span>Poliigon resolution</span><strong>{value}</strong><em aria-hidden="true">×</em>
            </button>
          ))}
          {!isHdri && poliCreationMethods.map(value => (
            <button type="button" key={`poli:method:${value}`} className="facet-chip active" onClick={() => usePoliigonStore.getState().toggleCreationMethod(value)}>
              <span>Poliigon method</span><strong>{titleCase(value)}</strong><em aria-hidden="true">×</em>
            </button>
          ))}
          {!isHdri && poliMapTypes.map(value => (
            <button type="button" key={`poli:map:${value}`} className="facet-chip active" onClick={() => usePoliigonStore.getState().toggleMapType(value)}>
              <span>Poliigon map</span><strong>{titleCase(value)}</strong><em aria-hidden="true">×</em>
            </button>
          ))}
          {isHdri && poliWeather.map(value => (
            <button type="button" key={`poli:weather:${value}`} className="facet-chip active" onClick={() => togglePoliWeather(value)}>
              <span>Poliigon sky</span><strong>{skyConditionLabel(value)}</strong><em aria-hidden="true">×</em>
            </button>
          ))}
          {polyResolutions.map(value => (
            <button type="button" key={`poly:res:${value}`} className="facet-chip active" onClick={() => usePolyHavenStore.getState().toggleResolution(value)}>
              <span>Poly Haven resolution</span><strong>{value.toUpperCase()}</strong><em aria-hidden="true">×</em>
            </button>
          ))}
          {!isHdri && polyMapTypes.map(value => (
            <button type="button" key={`poly:map:${value}`} className="facet-chip active" onClick={() => usePolyHavenStore.getState().toggleMapType(value)}>
              <span>Poly Haven map</span><strong>{polyHavenMapLabel(value)}</strong><em aria-hidden="true">×</em>
            </button>
          ))}
          {!isHdri && polyCategories.map(value => (
            <button type="button" key={`poly:cat:${value}`} className="facet-chip active" onClick={() => usePolyHavenStore.getState().toggleCategory(value)}>
              <span>Poly Haven category</span><strong>{titleCase(value)}</strong><em aria-hidden="true">×</em>
            </button>
          ))}
          {polyCollections.map(value => (
            <button type="button" key={`poly:collection:${value}`} className="facet-chip active" onClick={() => usePolyHavenStore.getState().toggleCollection(value)}>
              <span>Poly Haven collection</span><strong>{titleCase(value.replace(/^collection:\s*/i, ""))}</strong><em aria-hidden="true">×</em>
            </button>
          ))}
          {publicChips()}
          {Object.entries(polyAttributeFilters).flatMap(([key, values]) => values.map(value => (
            <button type="button" key={`poly:attribute:${key}:${value}`} className="facet-chip active" onClick={() => togglePolyAttribute(key, value)}>
              <span>Poly Haven {polyHavenAttributeLabel(key)}</span>
              <strong>{polyHavenAttributeValue(value)}</strong>
              <em aria-hidden="true">×</em>
            </button>
          )))}
          {(allType || allStateFilter !== "all" || sizeFilter !== "any" || hasTimeFilter || activeFacetCount > 0) && (
            <button type="button" className="text-btn" onClick={clearFilters}>Clear filters</button>
          )}
        </div>

        {filtersOpen && (
          <section className="facet-panel" id="all-source-filter-panel" aria-label="All-source filters">
            <div className="facet-panel-head">
              <div className="facet-panel-heading">
                <strong>Refine all sources</strong>
                <span aria-live="polite">
                  {isHdri
                    ? "Sky condition uses normalised weather metadata · time filters apply to both providers"
                    : activeFacetCount > 0
                      ? `${activeFacetCount} active facet${activeFacetCount === 1 ? "" : "s"}`
                      : "Megascans, Poliigon and Poly Haven filters apply together"}
                </span>
              </div>
              <div className="facet-panel-actions">
                <button type="button" className="text-btn" onClick={clearFilters} disabled={allType === "" && allStateFilter === "all" && sizeFilter === "any" && !hasTimeFilter && activeFacetCount === 0}>
                  Clear filters
                </button>
                <button type="button" className="icon-btn" onClick={() => setFiltersOpen(false)} aria-label="Close filters">
                  <CloseIcon />
                </button>
              </div>
            </div>
            {filterGroups.length === 0 ? (
              <p className="hint">Run a search to load available filters.</p>
            ) : (
              <FilterWorkbench
                activeGroup={activeGroup}
                onActiveGroup={setActiveGroup}
                groups={orderedFilterGroups}
              />
            )}
          </section>
        )}

        {selectMode && (
          <div className="bulk-bar">
            <div className="bulk-scope">
              <span className="bulk-count" aria-live="polite">{selectedKeys.size.toLocaleString()} selected</span>
              <span className="bulk-scope-detail">
                {selectedKeys.size === 0
                  ? `${assetCountLabel(total)} match current filters`
                  : selectedKeys.size === total
                    ? `All ${total.toLocaleString()} matching assets`
                    : `${selectedKeys.size.toLocaleString()} of ${total.toLocaleString()} matching assets`}
              </span>
              <span className="bulk-scope-hint">Megascans, Poliigon and Poly Haven downloads are queued in their own pipelines.</span>
            </div>
            <div className="bulk-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setListView(value => !value)}>
                {listView ? "Grid view" : "List / compare view"}
              </button>
              <button type="button" className="text-btn" onClick={selectLoaded} disabled={merged.length === 0}>
                Select loaded ({merged.length.toLocaleString()})
              </button>
              <button type="button" className="text-btn" onClick={() => void selectAllFiltered()} disabled={selectingAll || total === 0}>
                {selectingAll ? "Selecting…" : `${selectedKeys.size > 0 ? "Add" : "Select"} all ${total.toLocaleString()}`}
              </button>
              <button type="button" className="btn btn-accent bulk-download" disabled={selectedKeys.size === 0} onClick={() => void downloadSelected()}>
                Download selected
              </button>
              <button type="button" className="text-btn" onClick={() => setSelectedKeys(new Set())} disabled={selectedKeys.size === 0}>
                Clear
              </button>
              <button type="button" className="text-btn" onClick={() => setSelectMode(false)}>Done</button>
            </div>
          </div>
        )}

        {(!auth.loggedIn || !poliAuth.loggedIn || !blenderkitAuth.hasKey) && (
          <div className="login-banner">
            <UserIcon />
            <span>
              Browse all sources openly. Account setup is required to download from{" "}
              {[!auth.loggedIn ? "Megascans" : "", !poliAuth.loggedIn ? "Poliigon" : "", !blenderkitAuth.hasKey ? "BlenderKit" : ""].filter(Boolean).join(", ")}.
            </span>
            {!auth.loggedIn && (
              <button type="button" className="btn btn-ghost" onClick={() => void login()}>
                Sign in to Megascans
              </button>
            )}
            {!poliAuth.loggedIn && (
              <button type="button" className="btn btn-primary" onClick={openPoliigonLogin}>
                Sign in to Poliigon
              </button>
            )}
            {!blenderkitAuth.hasKey && (
              <button type="button" className="btn btn-ghost" onClick={() => useStore.getState().setView("settings")}>
                Add BlenderKit key
              </button>
            )}
          </div>
        )}
      </div>

      <div className="view-body discover-body">
        <div className="asset-area" ref={bodyRef}>
          {(megaEnabled && megaError || poliEnabled && poliError || polyEnabled && polyError) && (
            <div className="error-box" role="alert">
              {megaEnabled && megaError && <span>Megascans: {megaError}</span>}
              {poliEnabled && poliError && <span>Poliigon: {poliError}</span>}
              {polyEnabled && polyError && <span>Poly Haven: {polyError}</span>}
              <button type="button" className="btn btn-ghost" disabled={loading} onClick={() => useStore.getState().syncAllSources()}>
                Retry
              </button>
            </div>
          )}

          {(publicIndexing.length > 0 || publicUnindexed.length > 0) && (
            <div className="poliigon-indexing" role="status">
              <div className="spinner" />
              <div>
                <strong>{publicIndexing.length > 0 ? `Indexing ${publicIndexing.map(provider => publicProviderLabel(provider)).join(" and ")}…` : `${publicUnindexed.map(provider => publicProviderLabel(provider)).join(" and ")} not indexed yet`}</strong>
                <p>Existing results remain available. Build the local catalogue to include all of its assets in the combined view.</p>
                {publicUnindexed.map(provider => <button key={provider} type="button" className="btn btn-ghost" onClick={() => void window.openbridge.public.refresh(provider).then(() => usePublicStore.getState().init(provider)).catch(error => useStore.getState().toast(String(error), true))}>Index {publicProviderLabel(provider)}</button>)}
              </div>
            </div>
          )}
          {(poliIndexing || polyIndexing) && (
            <div className="poliigon-indexing" role="status">
              <div className="spinner" />
              <div>
                <strong>
                  Building the {poliIndexing && polyIndexing ? "Poliigon and Poly Haven" : poliIndexing ? "Poliigon" : "Poly Haven"} catalogue index
                </strong>
                <p>
                  Existing results are available while the public catalogue is indexed locally.
                </p>
              </div>
            </div>
          )}

          {poliUnavailable && (
            <div className="empty">
              <h2>Poliigon catalogue is not indexed yet</h2>
              <p>{poliStatus?.error ?? "Download the public catalogue to include Poliigon in this view."}</p>
              <button type="button" className="btn btn-primary" onClick={() => void refreshPoliigon()}>
                Index Poliigon catalogue
              </button>
            </div>
          )}

          {polyUnavailable && (
            <div className="empty">
              <h2>Poly Haven catalogue is not indexed yet</h2>
              <p>{polyStatus?.error ?? "Download the public CC0 catalogue to include Poly Haven in this view."}</p>
              <button type="button" className="btn btn-primary" onClick={() => void refreshPolyHaven()}>
                Index Poly Haven catalogue
              </button>
            </div>
          )}

          <div className="asset-heading">
            {query.trim()
              ? "Search results"
              : allType
                ? selectedCategory
                : "All assets"}
          </div>

          {merged.length > 0 && listView && (
            <AssetList
              key={selectMode ? "bulk" : "browse"}
              selectedKeys={selectMode ? selectedKeys : undefined}
              totalSelected={selectMode ? selectedKeys.size : undefined}
              initialCompare={selectMode && selectedKeys.size >= 2}
              onToggle={selectMode ? key => {
                const item = merged.find(entry => entry.key === key);
                if (item) toggleSelection(item);
              } : undefined}
              items={merged.map(item => {
                if (item.provider === "megascans") {
                  const hit = item.hit;
                  const id = hitId(hit);
                  const technical = hit.metadata?.technical;
                  return {
                    key: item.key,
                    id,
                    name: hit.name || id,
                    type: typeLabel(hit.type),
                    image: hitPreview(hit) ?? hitThumb(hit),
                    technical,
                    dimensions: technical?.dimensions ?? hit.physicalSize,
                    resolution: technical?.resolution ? `${technical.resolution / 1024}K` : hit.resolution ? String(hit.resolution) : null,
                    category: hit.categories?.slice(0, 2).join(" / "),
                    facts: [...galleryFacts(hit), ...readinessBadges(technical)],
                    status: megaLocal.has(id) ? "Downloaded" : megaOwned.has(id) ? "Owned" : (hit.points ?? 0) === 0 ? "Free" : "Not acquired",
                    onOpen: () => openItem(item)
                  };
                }
                if (item.provider === "polyhaven") {
                  const hit = item.hit;
                  const technical = polyHavenTechnical(hit);
                  return {
                    key: item.key,
                    id: hit.id,
                    name: hit.name,
                    type: assetTypeLabel(hit.typeLabel),
                    image: hit.type === "hdris"
                      ? polyHavenPrimaryPreview(hit.thumbnail, 512) ?? hit.thumbnail
                      : hit.thumbnail,
                    technical,
                    dimensions: hit.dimensions,
                    resolution: hit.maxResolution ? `${Math.round(hit.maxResolution / 1024)}K` : null,
                    category: hit.category || hit.categories.slice(0, 2).join(" / "),
                    facts: hit.type === "hdris"
                      ? [
                          hit.maxResolution ? `${Math.round(hit.maxResolution / 1024)}K` : null,
                          hit.attributes.weather ? polyHavenAttributeValue(hit.attributes.weather) : null,
                          formatHdriTime(hit.timeOfDay)
                        ].filter((value): value is string => Boolean(value))
                      : [
                          hit.mapCodes.length > 0 ? `${hit.mapCodes.length} map${hit.mapCodes.length === 1 ? "" : "s"}` : null,
                          hit.polycount ? `${hit.polycount.toLocaleString()} tris` : null,
                          hit.dimensions
                        ].filter((value): value is string => Boolean(value)),
                    status: polyLocal[hit.id] ? "Downloaded" : "Free",
                    onOpen: () => openItem(item)
                  };
                }
                if (item.provider === "public") return {
                  key: item.key, id: item.hit.id, name: item.hit.name, type: `${publicProviderLabel(item.hit.provider)} · ${item.hit.typeLabel}`,
                  image: publicCardThumbnail(item.hit, 512), crop: item.hit.provider === "openhdri" ? "top-2-1" as const : undefined,
                  direct: item.hit.provider === "ambientcg" && /^(hdri|hdri-element)$/i.test(item.hit.type),
                  technical: publicTechnical(item.hit), dimensions: item.hit.dimensions,
                  resolution: item.hit.maxResolution ? `${Math.round(item.hit.maxResolution / 1024)}K` : null,
                  category: item.hit.category, facts: [item.hit.license, ...publicProviderFacts(item.hit)].slice(0, 6),
                  status: megaLocal.has(item.key) ? "Downloaded" : item.hit.provider === "blenderkit" && item.hit.attributes.canDownload === false ? "Account required" : item.hit.free ? "Free" : "Plan required",
                  onOpen: () => openItem(item)
                };
                const hit = item.hit;
                const technical = poliigonTechnical(hit);
                return {
                  key: item.key,
                  id: String(hit.id),
                  name: hit.name,
                  type: assetTypeLabel(hit.typeLabel),
                  image: hit.thumbnail,
                  technical,
                  dimensions: hit.physicalSize,
                  resolution: hit.maxResolution ? `${Math.round(hit.maxResolution / 1024)}K` : null,
                  category: hit.categories.slice(0, 2).join(" / "),
                  facts: hit.type === "HDRS"
                    ? [
                        hit.maxResolution ? `${Math.round(hit.maxResolution / 1024)}K` : null,
                        hit.weather ? skyConditionLabel(hit.weather) : null,
                        formatHdriTime(hit.timeOfDay)
                      ].filter((value): value is string => Boolean(value))
                    : [
                        `${hit.mapCodes.length} map${hit.mapCodes.length === 1 ? "" : "s"}`,
                        hit.lodCount > 0 ? `${hit.lodCount} LOD${hit.lodCount === 1 ? "" : "s"}` : null,
                        hit.physicalSize
                      ].filter((value): value is string => Boolean(value)),
                  status: poliLocal[hit.id]
                    ? "Downloaded"
                    : poliOwnedSet.has(hit.id)
                      ? "Owned"
                      : hit.free
                        ? "Free"
                        : poliAuth.isUnlimited
                          ? "Included"
                          : `${hit.credit} credit${hit.credit === 1 ? "" : "s"}`,
                  onOpen: () => openItem(item)
                };
              })}
            />
          )}

          {merged.length > 0 && (!listView || selectMode) && (
            <VirtualGrid
              items={merged}
              itemKey={item => item.key}
              minItemWidth={density === "compact" ? 160 : density === "large" ? 320 : 220}
              gap={28}
              aspectRatio={isHdri ? 2 : 1}
              renderItem={item => {
                if (item.provider === "public") {
                  const canDownload = item.hit.provider !== "blenderkit" || (blenderkitAuth.hasKey && item.hit.attributes.canDownload !== false);
                  return <PublicCard
                    hit={item.hit}
                    wide={isHdri}
                    selected={selectedKeys.has(item.key)}
                    selectionMode={selectMode}
                    onSelect={event => toggleSelection(item, event)}
                    onOpen={() => openItem(item)}
                    onDownload={canDownload ? () => void quickPublicDownload(item.hit) : undefined}
                    downloadReason={item.hit.provider === "blenderkit" ? (!blenderkitAuth.hasKey ? "Add a BlenderKit API key in Settings." : "BlenderKit account or plan required.") : ""}
                  />;
                }
                if (item.provider === "megascans") {
                  const hit = item.hit;
                  const id = hitId(hit);
                  return (
                    <AssetCard
                      key={item.key}
                      hit={hit}
                      owned={megaOwned.has(id)}
                      downloaded={megaLocal.has(id)}
                      favorited={megaFavoriteSet.has(id)}
                      canFavorite={auth.loggedIn}
                      localPath={megaLocal.get(id) ?? null}
                      progress={downloads[id]}
                      selectionMode={selectMode}
                      selected={selectedKeys.has(item.key)}
                      onPauseResume={() => {
                        const active = downloads[id];
                        if (!active) return;
                        if (active.status === "paused") void window.openbridge.downloads.resume(id);
                        else void window.openbridge.downloads.pause(id);
                      }}
                      onSelect={event => toggleSelection(item, event)}
                      onOpen={() => openItem(item)}
                      onToggleFavorite={() => void useStore.getState().toggleFavorite(id)}
                      onDownload={() => void useStore.getState().downloadHit(hit)}
                    />
                  );
                }
                if (item.provider === "polyhaven") {
                  const hit = item.hit;
                  return (
                    <PolyHavenCard
                      key={item.key}
                      hit={hit}
                      downloaded={Boolean(polyLocal[hit.id])}
                      favorited={polyFavoriteSet.has(hit.id)}
                      selectionMode={selectMode}
                      selected={selectedKeys.has(item.key)}
                      wide={isHdri}
                      onSelect={event => toggleSelection(item, event)}
                      onToggleFavorite={() => usePolyHavenStore.getState().toggleFavorite(hit.id)}
                      onDownload={() => void quickPolyHavenDownload(hit)}
                      onOpen={() => openItem(item)}
                    />
                  );
                }
                const hit = item.hit;
                return (
                  <PoliigonCard
                    key={item.key}
                    hit={hit}
                    owned={poliOwnedSet.has(hit.id)}
                    included={poliAuth.isUnlimited}
                    downloaded={Boolean(poliLocal[hit.id])}
                    favorited={poliFavoriteSet.has(hit.id)}
                    canDownload={Boolean(
                      !poliLocal[hit.id] &&
                      poliAuth.loggedIn &&
                      (poliAuth.isUnlimited || poliOwnedSet.has(hit.id) || hit.free)
                    )}
                    selectionMode={selectMode}
                    selected={selectedKeys.has(item.key)}
                    wide={isHdri}
                    onSelect={event => toggleSelection(item, event)}
                    onToggleFavorite={() => usePoliigonStore.getState().toggleFavorite(hit.id)}
                    onDownload={() => void quickPoliigonDownload(hit)}
                    onOpen={() => openItem(item)}
                  />
                );
              }}
            />
          )}

          {loading && merged.length === 0 && !poliIndexing && !polyIndexing && (
            <div className="asset-grid">
              {Array.from({ length: 18 }, (_, index) => (
                <div className="asset-card skeleton" key={index}>
                  <div className="asset-thumb" />
                  <div className="asset-meta">
                    <span className="skeleton-line" />
                    <span className="skeleton-line short" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!loading && !megaError && !poliError && !polyError && merged.length === 0 && (
            <div className="empty">
              <h2>{disabledProviders.length >= PUBLIC_PROVIDER_IDS.length + 3 ? "All sources are hidden" : "No assets found"}</h2>
              <p>{disabledProviders.length >= PUBLIC_PROVIDER_IDS.length + 3 ? "Enable a source to start browsing again." : "Try a different search or clear the filters."}</p>
              {disabledProviders.length >= PUBLIC_PROVIDER_IDS.length + 3 ? (
                <button type="button" className="btn btn-ghost" onClick={enableAllProviders}>Restore all sources</button>
              ) : (query || allType || allStateFilter !== "all" || sizeFilter !== "any" || hasTimeFilter || activeFacetCount > 0) && (
                <button type="button" className="btn btn-ghost" onClick={clearSearchAndFilters}>
                  {query ? "Clear search and filters" : "Clear filters"}
                </button>
              )}
            </div>
          )}

          {hasMore && (
            <LoadMore
              loading={loading}
              remaining={Math.max(0, total - merged.length)}
              onLoad={loadMore}
            />
          )}
        </div>
      </div>
    </div>
  );
}

async function quickPoliigonDownload(hit: PoliigonAssetSummary): Promise<void> {
  try {
    await window.openbridge.downloads.start(
      `poliigon:${hit.id}`,
      {
        resolution: hit.resolutions.includes("2K") ? "2K" : hit.resolutions.at(-1) ?? "2K",
        maps: [],
        lods: [],
        nativeMesh: true,
        renderer: "Cycles",
        software: "Blender"
      },
      "poliigon"
    );
    useStore.getState().toast(`Queued ${hit.name}`);
  } catch (error) {
    useStore.getState().toast(error instanceof Error ? error.message : String(error), true);
  }
}

async function quickPolyHavenDownload(hit: PolyHavenAssetSummary): Promise<void> {
  try {
    const options = hit.type === "hdris"
      ? { resolution: hit.resolutions.includes("2k") ? "2k" : hit.resolutions[0] ?? "2k", format: "hdr" }
      : hit.type === "models"
        ? {
            resolution: hit.resolutions.includes("2k") ? "2k" : hit.resolutions[0] ?? "2k",
            modelFormat: hit.modelFormats.includes("gltf") ? "gltf" : hit.modelFormats[0] ?? "gltf"
          }
        : {
            resolution: hit.resolutions.includes("2k") ? "2k" : hit.resolutions[0] ?? "2k",
            maps: hit.mapCodes
              .filter(code => /diffuse|albedo|col|nor_gl|normal|rough|ao|arm|metal/i.test(code))
              .map(type => ({ type, format: hit.mapFormats.includes("jpg") ? "jpg" : hit.mapFormats[0] ?? "jpg" }))
          };
    await window.openbridge.downloads.start(`polyhaven:${hit.id}`, options, "polyhaven");
    useStore.getState().toast(`Queued ${hit.name}`);
  } catch (error) {
    useStore.getState().toast(error instanceof Error ? error.message : String(error), true);
  }
}
