export function assetFixture(root, folder = "") {
  const f = (id, name, format, role, purpose = "source") => ({ id, root, path: folder + name, format, role, purpose });
  return {
    schemaVersion: 1, id: "fixture", name: "Prepared Prop", kind: "prop", defaultVariant: "hero",
    variants: [{ id: "hero", name: "Hero" }, { id: "alternate", name: "Alternate" }],
    files: [
      f("abc", "Source.abc", "abc", "geometry"), f("preview", "Prepared prop.glb", "glb", "geometry", "preview"),
      f("color", "Source Color.png", "png", "texture"), f("rig", "Rig.ma", "ma", "rig"),
      f("other", "Other.fbx", "fbx", "geometry"), f("color2", "Tile.1002.png", "png", "texture")
    ],
    evidence: [{ id: "audit", status: "verified", method: "fixture", note: "Synthetic acceptance fixture." }],
    representations: [
      { id: "geometry", file: "abc", variant: "hero", kind: "geometry-cache", selection: { kind: "all" },
        coordinates: { metersPerUnit: 1, up: "+Y", forward: "-Z", handedness: "right", evidence: ["audit"] },
        bindingSet: "surface-bindings" },
      { id: "maya-rig", file: "rig", variant: "hero", kind: "rig", selection: { kind: "all" },
        coordinates: { metersPerUnit: 0.01, up: "+Y", forward: null, handedness: null } },
      { id: "alternate-fbx", file: "other", variant: "alternate", kind: "static-mesh",
        selection: { kind: "objects", paths: ["/Variant/Body"] },
        coordinates: { metersPerUnit: null, up: null, forward: null, handedness: null } }
    ],
    textures: [
      { id: "albedo", encoding: { space: "srgb", evidence: ["audit"] }, source: { kind: "file", file: "color" } },
      { id: "tile-data", encoding: { space: "raw" }, source: { kind: "udim", pattern: "Tile.<UDIM>.png",
        tiles: [{ tile: 1001, file: "color" }, { tile: 1002, file: "color2" }] } }
    ],
    materials: [
      { id: "surface", name: "Paint",
        native: { renderer: "V-Ray", parameters: { coat: 0.7 } },
        portable: { model: "standard-surface", parameters: { roughness: 0.4 },
          inputs: [{ role: "base_color", texture: "albedo" }] } }
    ],
    bindingSets: [{ id: "surface-bindings", representation: "geometry", complete: true,
      assignments: [{ kind: "object-path", key: "/source/materials/paint", material: "surface" }] }],
    handoffs: [
      { variant: "hero", representation: "geometry", target: "houdini", renderer: "arnold", status: "ready", evidence: ["audit"] },
      { variant: "hero", representation: "maya-rig", target: "maya", status: "ready", evidence: ["audit"] },
      { variant: "alternate", representation: "alternate-fbx", target: "houdini", renderer: "arnold",
        status: "blocked", reasons: ["Unverified variant scale."] }
    ]
  };
}
