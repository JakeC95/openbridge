import type { CategoryNode } from "../shared/types";

/**
 * Cross-provider taxonomy for the combined Discover view.
 *
 * Provider vocabularies are mapped into one content tree. A node may use one
 * provider type, several provider category paths, or no results for a provider
 * (NONE_TYPE). Megascans category paths are keys from its catalogue tree;
 * Poliigon paths are label paths from its public category tree and are resolved
 * to category IDs at runtime.
 */
export const NONE_TYPE = "__none__";

export interface AllCategoryNode {
  value: string;
  label: string;
  megascansPaths?: string[][];
  megascansType?: string;
  poliigonPaths?: string[][];
  poliigonType?: string;
  /** Flat Poly Haven category tags (as published on the asset summary). */
  polyhavenCategories?: string[];
  polyhavenType?: string;
  children?: AllCategoryNode[];
}

const NONE = NONE_TYPE;

export const ALL_CONTENT: AllCategoryNode = {
  value: "",
  label: "All content"
};

export const ALL_SOURCE_TREE: AllCategoryNode[] = [
  {
    value: "3d",
    label: "3D Assets",
    megascansPaths: [["3D asset"], ["3D plant"]],
    poliigonType: "Models",
    polyhavenType: "models",
    children: [
      {
        value: "3d:architecture",
        label: "Architecture & Building",
        megascansPaths: [["3D asset", "building"]],
        poliigonType: "Models",
        poliigonPaths: [["Models", "Bathroom"], ["Models", "Fixtures"], ["Models", "Brick"], ["Models", "Curtains"]],
        polyhavenType: "models",
        polyhavenCategories: ["structures", "buildings"]
      },
      {
        value: "3d:furniture",
        label: "Furniture",
        megascansPaths: [["3D asset", "interior", "furniture"]],
        poliigonType: "Models",
        poliigonPaths: [["Models", "Furniture"], ["Models", "Seating"], ["Models", "Rugs"]],
        polyhavenType: "models",
        polyhavenCategories: ["furniture", "seating", "table", "bed", "shelves"]
      },
      {
        value: "3d:decor",
        label: "Decor & Props",
        megascansPaths: [["3D asset", "interior", "decoration"], ["3D asset", "props"]],
        poliigonType: "Models",
        poliigonPaths: [
          ["Models", "Decoration"],
          ["Models", "Lighting"],
          ["Models", "Electronics"],
          ["Models", "Dining"],
          ["Models", "Drinks"],
          ["Models", "Bathroom", "Decorations"]
        ],
        polyhavenType: "models",
        polyhavenCategories: ["props", "decorative", "vases", "dishes", "lighting", "electronics", "wall decoration", "books", "instrument"]
      },
      {
        value: "3d:food",
        label: "Food & Drink",
        megascansPaths: [["3D asset", "food"]],
        poliigonType: "Models",
        poliigonPaths: [["Models", "Food"], ["Models", "Kitchen", "Food"], ["Models", "Dining"]],
        polyhavenType: "models",
        polyhavenCategories: ["food"]
      },
      {
        value: "3d:nature",
        label: "Rocks & Terrain",
        megascansPaths: [
          ["3D asset", "nature", "rock"],
          ["3D asset", "nature", "debris"],
          ["3D asset", "nature", "embankment"],
          ["3D asset", "nature", "seabed"],
          ["3D asset", "nature", "snow"]
        ],
        poliigonType: "Models",
        poliigonPaths: [["Models", "Nature"], ["Models", "Rocks"]],
        polyhavenType: "models",
        polyhavenCategories: ["rocks", "ground cover"]
      },
      {
        value: "3d:industrial",
        label: "Industrial & Street",
        megascansPaths: [["3D asset", "industrial"], ["3D asset", "street"]],
        poliigonType: NONE,
        polyhavenType: "models",
        polyhavenCategories: ["industrial", "tools", "containers", "appliances", "office", "weapons", "firearms", "vehicles"]
      },
      {
        value: "3d:historical",
        label: "Historical",
        megascansPaths: [["3D asset", "historical"]],
        poliigonType: NONE,
        polyhavenType: NONE
      }
    ]
  },
  {
    value: "plant",
    label: "3D Plants",
    megascansPaths: [["3D plant"], ["3D asset", "nature", "tree"]],
    poliigonType: "Models",
    poliigonPaths: [["Models", "Nature", "Vegetation"], ["Models", "Vegetation"], ["Models", "Decoration", "Plants"]],
    polyhavenType: "models",
    polyhavenCategories: ["plants", "trees", "ground cover", "flowers", "potted plants", "grass", "succulent"],
    children: [
      {
        value: "plant:houseplants",
        label: "Houseplants & Planters",
        megascansPaths: [["3D plant", "houseplant"]],
        poliigonType: "Models",
        poliigonPaths: [
          ["Models", "Vegetation", "Potted Plants"],
          ["Models", "Vegetation", "Potted Flowers"],
          ["Models", "Decoration", "Plants"],
          ["Models", "Decoration", "Planters"]
        ],
        polyhavenType: "models",
        polyhavenCategories: ["potted plants", "succulent", "vases"]
      },
      {
        value: "plant:garden",
        label: "Garden & Shrubs",
        megascansPaths: [["3D plant", "garden plant"], ["3D plant", "shrub"], ["3D plant", "climber"]],
        poliigonType: NONE,
        polyhavenType: "models",
        polyhavenCategories: ["ground cover", "plants"]
      },
      {
        value: "plant:flowers",
        label: "Flowers",
        megascansPaths: [["3D plant", "flowering plant"]],
        poliigonType: "Models",
        poliigonPaths: [["Models", "Vegetation", "Potted Flowers"], ["Models", "Decoration", "Flowers"]],
        polyhavenType: "models",
        polyhavenCategories: ["flowers", "potted plants"]
      },
      {
        value: "plant:ground",
        label: "Grasses & Ground Cover",
        megascansPaths: [["3D plant", "grass"], ["3D plant", "ground cover"], ["3D plant", "weed"], ["3D plant", "crop"]],
        poliigonType: NONE,
        polyhavenType: "models",
        polyhavenCategories: ["ground cover", "grass"]
      },
      {
        value: "plant:succulents",
        label: "Succulents, Ferns & Herbs",
        megascansPaths: [["3D plant", "succulent"], ["3D plant", "fern"], ["3D plant", "herb"], ["3D plant", "aquatic"]],
        poliigonType: NONE,
        polyhavenType: "models",
        polyhavenCategories: ["succulent"]
      },
      {
        value: "plant:trees",
        label: "Trees",
        megascansPaths: [["3D asset", "nature", "tree"]],
        poliigonType: NONE,
        polyhavenType: "models",
        polyhavenCategories: ["trees"]
      }
    ]
  },
  {
    value: "surface",
    label: "Surfaces",
    megascansPaths: [["surface"]],
    poliigonType: "Textures",
    polyhavenType: "textures",
    children: [
      {
        value: "surface:wood",
        label: "Wood & Flooring",
        megascansPaths: [["surface", "wood"]],
        poliigonType: "Textures",
        poliigonPaths: [["Textures", "Wood"], ["Textures", "Architectural", "Interior Floors"], ["Textures", "Architectural", "Exterior Floorings"]],
        polyhavenType: "textures",
        polyhavenCategories: ["wood", "raw wood"]
      },
      {
        value: "surface:stone",
        label: "Stone & Marble",
        megascansPaths: [["surface", "stone"], ["surface", "marble"], ["surface", "rock"]],
        poliigonType: "Textures",
        poliigonPaths: [["Textures", "Stone"], ["Textures", "Marble"], ["Textures", "Travertine"], ["Textures", "Ceramic"]],
        polyhavenType: "textures",
        polyhavenCategories: ["rock", "sandstone", "stone"]
      },
      {
        value: "surface:concrete",
        label: "Concrete & Plaster",
        megascansPaths: [["surface", "concrete"], ["surface", "plaster"], ["surface", "coal"]],
        poliigonType: "Textures",
        poliigonPaths: [["Textures", "Concrete"], ["Textures", "Plaster"], ["Textures", "Architectural", "Microcement"]],
        polyhavenType: "textures",
        polyhavenCategories: ["plaster-concrete", "concrete", "plaster"]
      },
      {
        value: "surface:brick",
        label: "Brick & Tile",
        megascansPaths: [["surface", "brick"], ["surface", "tile"]],
        poliigonType: "Textures",
        poliigonPaths: [["Textures", "Brick"], ["Textures", "Tile"], ["Textures", "Ceramic"]],
        polyhavenType: "textures",
        polyhavenCategories: ["brick", "tiles"]
      },
      {
        value: "surface:metal",
        label: "Metal",
        megascansPaths: [["surface", "metal"]],
        poliigonType: "Textures",
        poliigonPaths: [["Textures", "Metal"]],
        polyhavenType: "textures",
        polyhavenCategories: ["metal"]
      },
      {
        value: "surface:fabric",
        label: "Fabric & Textiles",
        megascansPaths: [["surface", "fabric"], ["surface", "other", "fur"]],
        poliigonType: "Textures",
        poliigonPaths: [
          ["Textures", "Fabric"],
          ["Textures", "Architectural", "Furniture Upholstery"],
          ["Textures", "Architectural", "Carpets"],
          ["Textures", "Architectural", "Curtains"]
        ],
        polyhavenType: "textures",
        polyhavenCategories: ["fabric", "leather", "denim", "wool", "fleece", "knitted", "fur", "hessian", "crepe", "jacquard", "satin", "carpet", "corduroy", "suede", "woven", "velvet", "cotton"]
      },
      {
        value: "surface:ground",
        label: "Ground & Nature",
        megascansPaths: [
          ["surface", "ground"],
          ["surface", "grass"],
          ["surface", "moss"],
          ["surface", "sand"],
          ["surface", "snow"],
          ["surface", "soil"],
          ["surface", "gravel"]
        ],
        poliigonType: "Textures",
        poliigonPaths: [["Textures", "Earth"], ["Textures", "Nature"]],
        polyhavenType: "textures",
        polyhavenCategories: ["terrain", "sand", "gravel", "snow", "rock", "cobblestone"]
      },
      {
        value: "surface:urban",
        label: "Roads & Urban",
        megascansPaths: [["surface", "asphalt"]],
        poliigonType: "Textures",
        poliigonPaths: [["Textures", "Asphalt"], ["Textures", "Urban"]],
        polyhavenType: "textures",
        polyhavenCategories: ["asphalt", "road", "cobblestone"]
      },
      {
        value: "surface:walls",
        label: "Roofing & Walls",
        megascansPaths: [["surface", "roofing"], ["surface", "historical"]],
        poliigonType: "Textures",
        poliigonPaths: [
          ["Textures", "Architectural", "Roofing"],
          ["Textures", "Architectural", "Interior Walls"],
          ["Textures", "Architectural", "Exterior Wall Cladding"],
          ["Textures", "Architectural", "Wall Coverings"]
        ],
        polyhavenType: "textures",
        polyhavenCategories: ["wall", "roofing"]
      },
      {
        value: "surface:other",
        label: "Other Surfaces",
        megascansPaths: [["surface", "other"], ["surface", "bark"], ["surface", "branch"], ["surface", "debris"]],
        poliigonType: "Textures",
        poliigonPaths: [["Textures", "Paper"], ["Textures", "Plastic"], ["Textures", "Glass"], ["Textures", "Food"], ["Textures", "Backrooms"]],
        polyhavenType: "textures",
        polyhavenCategories: ["food", "industrial", "stretchy"]
      }
    ]
  },
  {
    value: "hdri",
    label: "HDRIs",
    megascansType: NONE,
    poliigonType: "HDRS",
    polyhavenType: "hdris",
    children: [
      {
        value: "hdri:skies",
        label: "Skies",
        megascansType: NONE,
        poliigonType: "HDRS",
        poliigonPaths: [["HDRIS", "Sky"]],
        polyhavenType: "hdris",
        polyhavenCategories: ["skies", "pure skies", "clear", "partly cloudy", "overcast", "sunrise-sunset", "midday", "night"],
        children: [
          {
            value: "hdri:clear",
            label: "Clear Skies",
            megascansType: NONE,
            poliigonType: "HDRS",
            poliigonPaths: [["HDRIS", "Sky", "Clear"]],
            polyhavenType: "hdris",
            polyhavenCategories: ["clear", "pure skies"]
          },
          {
            value: "hdri:partly-cloudy",
            label: "Partly Cloudy",
            megascansType: NONE,
            poliigonType: "HDRS",
            poliigonPaths: [["HDRIS", "Sky", "Partly Cloudy"]],
            polyhavenType: "hdris",
            polyhavenCategories: ["partly cloudy"]
          },
          {
            value: "hdri:overcast",
            label: "Overcast",
            megascansType: NONE,
            poliigonType: "HDRS",
            poliigonPaths: [["HDRIS", "Sky", "Overcast"]],
            polyhavenType: "hdris",
            polyhavenCategories: ["overcast"]
          },
          {
            value: "hdri:sunrise-sunset",
            label: "Sunrise & Sunset",
            megascansType: NONE,
            poliigonType: "HDRS",
            poliigonPaths: [["HDRIS", "Sky", "Sunrise"], ["HDRIS", "Sky", "Sunset"]],
            polyhavenType: "hdris",
            polyhavenCategories: ["sunrise-sunset"]
          },
          {
            value: "hdri:evening",
            label: "Evening",
            megascansType: NONE,
            poliigonType: "HDRS",
            poliigonPaths: [["HDRIS", "Sky", "Evening"]],
            polyhavenType: NONE
          },
          {
            value: "hdri:night",
            label: "Night",
            megascansType: NONE,
            poliigonType: "HDRS",
            poliigonPaths: [["HDRIS", "Sky", "Night"]],
            polyhavenType: "hdris",
            polyhavenCategories: ["night"]
          }
        ]
      },
      {
        value: "hdri:environments",
        label: "Environments",
        megascansType: NONE,
        poliigonType: "HDRS",
        poliigonPaths: [["HDRIS", "Environment"], ["HDRIS", "Arid"], ["HDRIS", "Coastal"], ["HDRIS", "fields"]],
        polyhavenType: "hdris",
        polyhavenCategories: ["nature", "urban", "indoor", "studio", "outdoor"],
        children: [
          {
            value: "hdri:arid",
            label: "Arid & Desert",
            megascansType: NONE,
            poliigonType: "HDRS",
            poliigonPaths: [["HDRIS", "Arid"]],
            polyhavenType: NONE
          },
          {
            value: "hdri:coastal",
            label: "Coastal",
            megascansType: NONE,
            poliigonType: "HDRS",
            poliigonPaths: [["HDRIS", "Coastal"]],
            polyhavenType: NONE
          },
          {
            value: "hdri:fields",
            label: "Fields & Rural",
            megascansType: NONE,
            poliigonType: "HDRS",
            poliigonPaths: [["HDRIS", "fields"]],
            polyhavenType: NONE
          },
          {
            value: "hdri:environment",
            label: "General Environments",
            megascansType: NONE,
            poliigonType: "HDRS",
            poliigonPaths: [["HDRIS", "Environment"]],
            polyhavenType: "hdris",
            polyhavenCategories: ["nature", "urban", "indoor", "studio", "outdoor"]
          }
        ]
      },
      {
        value: "hdri:urban",
        label: "Urban",
        megascansType: NONE,
        poliigonType: "HDRS",
        poliigonPaths: [["HDRIS", "Urban"]],
        polyhavenType: "hdris",
        polyhavenCategories: ["urban"]
      },
      {
        value: "hdri:industrial",
        label: "Industrial",
        megascansType: NONE,
        poliigonType: "HDRS",
        poliigonPaths: [["HDRIS", "Industrial"]],
        polyhavenType: NONE
      }
    ]
  },
  {
    value: "atlas",
    label: "Atlases",
    megascansPaths: [["atlas"]],
    poliigonType: "Textures",
    poliigonPaths: [["Textures", "Atlas"]],
    children: [
      {
        value: "atlas:plants",
        label: "Plants & Foliage",
        megascansPaths: [
          ["atlas", "plant"],
          ["atlas", "tree"],
          ["atlas", "shrub"],
          ["atlas", "fern"],
          ["atlas", "herb"],
          ["atlas", "vine"],
          ["atlas", "grass"],
          ["atlas", "weed"],
          ["atlas", "moss"]
        ],
        poliigonType: "Textures",
        poliigonPaths: [["Textures", "Atlas", "Nature"]]
      },
      {
        value: "atlas:debris",
        label: "Ground & Debris",
        megascansPaths: [["atlas", "debris"]],
        poliigonType: NONE
      },
      {
        value: "atlas:water",
        label: "Water",
        megascansPaths: [["atlas", "fresh water"], ["atlas", "ocean"]],
        poliigonType: NONE
      }
    ]
  },
  {
    value: "decal",
    label: "Decals",
    megascansPaths: [["decal"]],
    poliigonType: "Textures",
    poliigonPaths: [["Textures", "Atlas", "Decal"]],
    children: [
      {
        value: "decal:street",
        label: "Street & Urban",
        megascansPaths: [["decal", "street"], ["decal", "commercial"]],
        poliigonType: NONE
      },
      {
        value: "decal:vegetation",
        label: "Vegetation",
        megascansPaths: [["decal", "vegetation"], ["decal", "tree"], ["decal", "moss"]],
        poliigonType: NONE
      },
      {
        value: "decal:graffiti",
        label: "Graffiti",
        megascansPaths: [["decal", "graffiti"]],
        poliigonType: NONE
      },
      {
        value: "decal:damage",
        label: "Damage & Grime",
        megascansPaths: [["decal", "concrete"], ["decal", "metal"], ["decal", "leakage"], ["decal", "mud"], ["decal", "blood"]],
        poliigonType: NONE
      },
      {
        value: "decal:debris",
        label: "Debris & Materials",
        megascansPaths: [
          ["decal", "debris"],
          ["decal", "stone"],
          ["decal", "wood"],
          ["decal", "trim"],
          ["decal", "fabric"],
          ["decal", "door"],
          ["decal", "other"]
        ],
        poliigonType: NONE
      }
    ]
  },
  {
    value: "brush",
    label: "Brushes",
    megascansPaths: [["brush"]],
    poliigonType: NONE,
    children: [
      {
        value: "brush:damage",
        label: "Damage & Grunge",
        megascansPaths: [["brush", "damage"], ["brush", "grunge"], ["brush", "scorch mark"], ["brush", "imprint"]],
        poliigonType: NONE
      },
      {
        value: "brush:graffiti",
        label: "Graffiti",
        megascansPaths: [["brush", "graffiti"]],
        poliigonType: NONE
      },
      {
        value: "brush:stains",
        label: "Stains & Spills",
        megascansPaths: [["brush", "stain"], ["brush", "blood"], ["brush", "spatter"], ["brush", "leakage"], ["brush", "dirt"]],
        poliigonType: NONE
      },
      {
        value: "brush:natural",
        label: "Natural & Traditional",
        megascansPaths: [["brush", "traditional"], ["brush", "sponge"]],
        poliigonType: NONE
      }
    ]
  },
  {
    value: "imperfection",
    label: "Imperfections",
    megascansPaths: [["imperfection"]],
    poliigonType: "Textures",
    poliigonPaths: [["Textures", "Surface Imperfections"]],
    children: [
      {
        value: "imperfection:damage",
        label: "Damage & Scratches",
        megascansPaths: [["imperfection", "damage"], ["imperfection", "metal", "scratched"]],
        poliigonType: "Textures",
        poliigonPaths: [["Textures", "Surface Imperfections", "Scratches"], ["Textures", "Surface Imperfections", "Flooring"]]
      },
      {
        value: "imperfection:dirt",
        label: "Dirt & Stains",
        megascansPaths: [["imperfection", "dirt"], ["imperfection", "stain"]],
        poliigonType: "Textures",
        poliigonPaths: [["Textures", "Surface Imperfections", "Dirt"]]
      },
      {
        value: "imperfection:grunge",
        label: "Grunge & Marks",
        megascansPaths: [
          ["imperfection", "grunge"],
          ["imperfection", "fingerprint"],
          ["imperfection", "wipe mark"],
          ["imperfection", "grain"],
          ["imperfection", "frost"],
          ["imperfection", "rubber"],
          ["imperfection", "stone"],
          ["imperfection", "other"]
        ],
        poliigonType: "Textures",
        poliigonPaths: [
          ["Textures", "Surface Imperfections", "Smudges"],
          ["Textures", "Surface Imperfections", "Water Droplets"]
        ]
      }
    ]
  },
  {
    value: "displacement",
    label: "Displacements",
    megascansPaths: [["displacement"]],
    poliigonType: NONE
  }
];




export type AllStateFilter = "all" | "free" | "favorites" | "downloaded";
export type AllSort =
  | "relevance"
  | "name"
  | "type"
  | "size"
  | "resolution"
  | "triangles"
  | "maps";

const CATEGORY_INDEX = new Map<string, AllCategoryNode>();
const CATEGORY_PARENT = new Map<string, string | null>();

function indexTree(nodes: AllCategoryNode[], parent: string | null): void {
  for (const node of nodes) {
    CATEGORY_INDEX.set(node.value, node);
    CATEGORY_PARENT.set(node.value, parent);
    if (node.children) indexTree(node.children, node.value);
  }
}
indexTree(ALL_SOURCE_TREE, null);

export function allSourceCategory(value: string | null | undefined): AllCategoryNode {
  if (!value) return ALL_CONTENT;
  return CATEGORY_INDEX.get(value) ?? ALL_CONTENT;
}

export function allSourcePath(value: string | null | undefined): string[] {
  if (!value) return [];
  const path: string[] = [];
  let current: string | null | undefined = value;
  while (current) {
    path.unshift(current);
    current = CATEGORY_PARENT.get(current) ?? null;
  }
  return path;
}

export function allCategoryNodes(): CategoryNode[] {
  const map = (nodes: AllCategoryNode[]): CategoryNode[] => nodes.map(node => ({
    key: node.value,
    label: node.label,
    count: 0,
    children: map(node.children ?? [])
  }));
  return map(ALL_SOURCE_TREE);
}

/** Resolve a label path such as Models / Vegetation to Poliigon category IDs. */
export function poliigonCategoryIds(categories: CategoryNode[], paths: string[][]): number[] {
  const ids = new Set<number>();
  const visit = (nodes: CategoryNode[], labels: string[], index: number): void => {
    const wanted = labels[index]?.toLowerCase();
    if (!wanted) return;
    for (const node of nodes) {
      if (node.label.toLowerCase() !== wanted) continue;
      if (index === labels.length - 1) {
        const id = Number(node.key);
        if (Number.isFinite(id)) ids.add(id);
      } else {
        visit(node.children, labels, index + 1);
      }
    }
  };
  for (const path of paths) visit(categories, path, 0);
  return [...ids];
}

export function isAllStateFilter(value: unknown): value is AllStateFilter {
  return value === "all" || value === "free" || value === "favorites" || value === "downloaded";
}

export function isAllSort(value: unknown): value is AllSort {
  return ["relevance", "name", "type", "size", "resolution", "triangles", "maps"].includes(
    typeof value === "string" ? value : ""
  );
}
