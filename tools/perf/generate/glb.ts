import type { GlbContents, GltfAccessor, GltfJson } from '../../../apps/desktop/src/main/glb';
import { encodePng } from './png';

/*
 * The two models of the big-assets scenario, built in memory as a glTF
 * document and its binary blob. `writeGlb`, the app's own, puts them in a file.
 *
 * Deterministic in everything the numbers depend on: the grids, the
 * displacement, the images. Each function answers its counts without encoding
 * a byte too, so a test can hold the full-size recipe to its sizes without
 * allocating it — and holds the encoding to those same counts at a size it
 * can afford.
 */

const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;

/**
 * A mesh as these files write one. `GltfJson` declares only what the
 * container code reads, and a primitive's material is not among it.
 */
interface Mesh {
  name: string;
  primitives: { attributes: Record<string, number>; indices: number; material: number }[];
}

/** glTF requires every view to start on a four-byte boundary. */
function aligned(length: number): number {
  return (length + 3) & ~3;
}

// ------------------------------------------------------------------ geometry

export interface GeometryRecipe {
  /** Group nodes under the scene. */
  readonly groups: number;
  /** Mesh nodes under each group, each with a mesh of its own. */
  readonly meshesPerGroup: number;
  /** Vertices along each side of a mesh's grid. 256 at most: the indices are 16-bit. */
  readonly gridSide: number;
  /** Untextured materials the meshes share. */
  readonly materials: number;
}

/**
 * The 340 MB model: 1 500 meshes of 9 800 triangles, about 15 million in all.
 *
 * Each mesh is its own grid, displaced differently, so nothing in the file can
 * be shared and the editor holds every byte of it. 71 vertices a side keeps the
 * indices 16-bit, which is what the import would narrow them to anyway: the
 * file is loaded as written.
 */
export const GEOMETRY: GeometryRecipe = { groups: 30, meshesPerGroup: 50, gridSide: 71, materials: 8 };

/** One mesh's bytes, view by view: positions, normals, uvs, then indices. */
function gridBytes(side: number): { position: number; normal: number; uv: number; index: number } {
  const vertices = side * side;
  const indices = 6 * (side - 1) * (side - 1);
  return { position: vertices * 12, normal: vertices * 12, uv: vertices * 8, index: aligned(indices * 2) };
}

export interface ModelCounts {
  readonly meshes: number;
  readonly triangles: number;
  readonly images: number;
  /** The binary chunk's length, before the container's padding. */
  readonly binBytes: number;
}

export function geometryCounts(recipe: GeometryRecipe): ModelCounts {
  const meshes = recipe.groups * recipe.meshesPerGroup;
  const bytes = gridBytes(recipe.gridSide);
  return {
    meshes,
    triangles: meshes * 2 * (recipe.gridSide - 1) ** 2,
    images: 0,
    binBytes: meshes * (bytes.position + bytes.normal + bytes.uv + bytes.index),
  };
}

/** Grid edge, and the distance between two grids' centres, in metres. */
const TILE = 2;
const SPACING = 2.2;
const AMPLITUDE = 0.25;

/** A colour per material, stepped round the hue circle so neighbours differ. */
function materialColor(index: number, count: number): [number, number, number, number] {
  const hue = index / count;
  const channel = (offset: number): number => 0.35 + 0.5 * Math.max(0, Math.cos(2 * Math.PI * (hue - offset)));
  return [channel(0), channel(1 / 3), channel(2 / 3), 1];
}

/**
 * Fills one grid into the blob at `at`, and says where its positions reach.
 *
 * The height is a product of a sine and a cosine whose frequencies and phase
 * come from the mesh's index, so every grid is different; the normals are its
 * derivatives, so the lighting is right without a second pass.
 */
function fillGrid(bin: Buffer, at: number, side: number, mesh: number): { min: number[]; max: number[] } {
  const bytes = gridBytes(side);
  const fx = 1 + (mesh % 3);
  const fz = 1 + ((mesh >> 2) % 3);
  const phase = mesh * 0.618;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      const vertex = row * side + column;
      const u = column / (side - 1);
      const v = row / (side - 1);
      const sx = Math.sin(2 * Math.PI * (u * fx + phase));
      const cz = Math.cos(2 * Math.PI * (v * fz + phase));
      const y = AMPLITUDE * sx * cz;
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);

      const position = at + vertex * 12;
      bin.writeFloatLE((u - 0.5) * TILE, position);
      bin.writeFloatLE(y, position + 4);
      bin.writeFloatLE((v - 0.5) * TILE, position + 8);

      // The slope along x and z, in metres per metre.
      const dx = (AMPLITUDE * 2 * Math.PI * fx * Math.cos(2 * Math.PI * (u * fx + phase)) * cz) / TILE;
      const dz = (-AMPLITUDE * 2 * Math.PI * fz * sx * Math.sin(2 * Math.PI * (v * fz + phase))) / TILE;
      const length = Math.hypot(dx, 1, dz);
      const normal = at + bytes.position + vertex * 12;
      bin.writeFloatLE(-dx / length, normal);
      bin.writeFloatLE(1 / length, normal + 4);
      bin.writeFloatLE(-dz / length, normal + 8);

      const uv = at + bytes.position + bytes.normal + vertex * 8;
      bin.writeFloatLE(u, uv);
      bin.writeFloatLE(v, uv + 4);
    }
  }

  // Two triangles a cell, both wound to face +y.
  let index = at + bytes.position + bytes.normal + bytes.uv;
  const corner = (vertex: number): void => {
    bin.writeUInt16LE(vertex, index);
    index += 2;
  };
  for (let row = 0; row < side - 1; row += 1) {
    for (let column = 0; column < side - 1; column += 1) {
      const a = row * side + column;
      corner(a);
      corner(a + side);
      corner(a + 1);
      corner(a + 1);
      corner(a + side);
      corner(a + side + 1);
    }
  }

  const half = TILE / 2;
  return { min: [-half, minY, -half], max: [half, maxY, half] };
}

/** The 340 MB model, as a document and its blob. */
export function geometryGlb(recipe: GeometryRecipe): GlbContents {
  const { gridSide: side } = recipe;
  const counts = geometryCounts(recipe);
  const bytes = gridBytes(side);
  const meshBytes = bytes.position + bytes.normal + bytes.uv + bytes.index;
  const vertices = side * side;
  const bin = Buffer.alloc(counts.binBytes);

  const bufferViews: NonNullable<GltfJson['bufferViews']> = [];
  const accessors: GltfAccessor[] = [];
  const meshes: Mesh[] = [];
  const nodes: NonNullable<GltfJson['nodes']> = [];
  const groupNodes: number[] = [];

  for (let group = 0; group < recipe.groups; group += 1) {
    const children: number[] = [];
    for (let column = 0; column < recipe.meshesPerGroup; column += 1) {
      const mesh = group * recipe.meshesPerGroup + column;
      const at = mesh * meshBytes;
      const bounds = fillGrid(bin, at, side, mesh);

      const view = bufferViews.length;
      bufferViews.push(
        { buffer: 0, byteOffset: at, byteLength: bytes.position },
        { buffer: 0, byteOffset: at + bytes.position, byteLength: bytes.normal },
        { buffer: 0, byteOffset: at + bytes.position + bytes.normal, byteLength: bytes.uv },
        {
          buffer: 0,
          byteOffset: at + bytes.position + bytes.normal + bytes.uv,
          byteLength: 6 * (side - 1) ** 2 * 2,
        },
      );
      const accessor = accessors.length;
      accessors.push(
        { bufferView: view, componentType: FLOAT, count: vertices, type: 'VEC3', ...bounds },
        { bufferView: view + 1, componentType: FLOAT, count: vertices, type: 'VEC3' },
        { bufferView: view + 2, componentType: FLOAT, count: vertices, type: 'VEC2' },
        { bufferView: view + 3, componentType: UNSIGNED_SHORT, count: 6 * (side - 1) ** 2, type: 'SCALAR' },
      );
      const primitive = {
        attributes: { POSITION: accessor, NORMAL: accessor + 1, TEXCOORD_0: accessor + 2 },
        indices: accessor + 3,
        material: mesh % recipe.materials,
      };
      meshes.push({ name: `Grid ${mesh}`, primitives: [primitive] });

      children.push(nodes.length);
      nodes.push({
        name: `Mesh ${group}-${column}`,
        mesh,
        translation: [(column - (recipe.meshesPerGroup - 1) / 2) * SPACING, 0, 0],
      });
    }
    groupNodes.push(nodes.length);
    nodes.push({
      name: `Group ${group}`,
      children,
      translation: [0, 0, (group - (recipe.groups - 1) / 2) * SPACING],
    });
  }

  const materials = Array.from({ length: recipe.materials }, (_, index) => ({
    name: `Material ${index}`,
    pbrMetallicRoughness: {
      baseColorFactor: materialColor(index, recipe.materials),
      metallicFactor: 0,
      roughnessFactor: 0.7,
    },
  }));

  const json: GltfJson = {
    asset: { version: '2.0', generator: 'three-studio tools/perf' },
    scene: 0,
    scenes: [{ nodes: groupNodes }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: bin.length }],
  };
  return { json, bin };
}

// ------------------------------------------------------------------ textures

export interface TexturesRecipe {
  /** Quads, each with a material of its own. */
  readonly primitives: number;
  /** Every image's width and height, in pixels. */
  readonly imageSide: number;
}

/**
 * The texture-heavy model: eight quads, each with a base colour, a normal and a
 * metallic-roughness image of 4096², all PNG.
 *
 * 24 images, 66 MB as a file; the default import caps them at 2 048, so the GPU
 * holds about 540 MB of them with their mipmaps.
 */
export const TEXTURES: TexturesRecipe = { primitives: 8, imageSide: 4096 };

const IMAGE_ROLES = ['baseColor', 'normal', 'metallicRoughness'] as const;
type ImageRole = (typeof IMAGE_ROLES)[number];

export function texturesCounts(recipe: TexturesRecipe): Omit<ModelCounts, 'binBytes'> {
  return { meshes: recipe.primitives, triangles: 2 * recipe.primitives, images: IMAGE_ROLES.length * recipe.primitives };
}

/** A cheap hash bit, so the images do not compress to nothing. */
function speck(x: number, y: number, seed: number): number {
  return Math.imul(x ^ Math.imul(y, 0x9e3779b1) ^ seed, 0x85ebca6b) >>> 31;
}

/**
 * One image's pixels: a pattern of its own per image, and a hash bit on every
 * eighth pixel.
 *
 * The bit is what gives a file its size. Without it a 4096² image of bands
 * deflates to under 2 MB, and the decode is then all that is measured of the
 * file; with it on every pixel the 24 images make 400 MB of PNG. On every
 * eighth pixel a base colour is 4.4 MB, nearer what a real texture of this
 * size weighs. The normal map stays close to straight up, and the roughness
 * off the extremes, so that what is drawn is lit as a surface would be.
 */
function imageRow(role: ImageRole, side: number, seed: number): (y: number, rgb: Buffer) => void {
  return (y, rgb) => {
    for (let x = 0; x < side; x += 1) {
      const noise = (x & 7) === 0 ? speck(x, y, seed) : 0;
      const bands = ((x >> 4) ^ (y >> 4)) & 0xff;
      const at = x * 3;
      if (role === 'baseColor') {
        rgb[at] = (bands + noise) & 0xff;
        rgb[at + 1] = ((x + seed) >> 3) & 0xff;
        rgb[at + 2] = ((y + seed) >> 3) & 0xff;
      } else if (role === 'normal') {
        rgb[at] = 120 + ((x >> 5) & 15) + noise;
        rgb[at + 1] = 120 + ((y >> 5) & 15);
        rgb[at + 2] = 255;
      } else {
        rgb[at] = 255;
        rgb[at + 1] = 96 + (bands & 63) + noise;
        rgb[at + 2] = ((x + y + seed) >> 5) & 31;
      }
    }
  };
}

/** The texture-heavy model, as a document and its blob. Encoding the images is most of its cost. */
export function texturesGlb(recipe: TexturesRecipe): GlbContents {
  // One quad, standing up and facing +z, shared by every mesh: the images are
  // what this model is about, and four vertices are nothing beside them.
  const quad = Buffer.alloc(4 * 12 + 4 * 12 + 4 * 8 + 6 * 2 + 2);
  [-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0].forEach((value, at) => quad.writeFloatLE(value, at * 4));
  [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1].forEach((value, at) => quad.writeFloatLE(value, 48 + at * 4));
  [0, 1, 1, 1, 0, 0, 1, 0].forEach((value, at) => quad.writeFloatLE(value, 96 + at * 4));
  [0, 1, 2, 2, 1, 3].forEach((value, at) => quad.writeUInt16LE(value, 128 + at * 2));

  const bufferViews: NonNullable<GltfJson['bufferViews']> = [
    { buffer: 0, byteOffset: 0, byteLength: 48 },
    { buffer: 0, byteOffset: 48, byteLength: 48 },
    { buffer: 0, byteOffset: 96, byteLength: 32 },
    { buffer: 0, byteOffset: 128, byteLength: 12 },
  ];
  const accessors: GltfAccessor[] = [
    { bufferView: 0, componentType: FLOAT, count: 4, type: 'VEC3', min: [-1, -1, 0], max: [1, 1, 0] },
    { bufferView: 1, componentType: FLOAT, count: 4, type: 'VEC3' },
    { bufferView: 2, componentType: FLOAT, count: 4, type: 'VEC2' },
    { bufferView: 3, componentType: UNSIGNED_SHORT, count: 6, type: 'SCALAR' },
  ];

  const pieces: Buffer[] = [quad];
  let offset = quad.length;
  const images: NonNullable<GltfJson['images']> = [];
  for (let primitive = 0; primitive < recipe.primitives; primitive += 1) {
    for (const role of IMAGE_ROLES) {
      const seed = images.length * 7919;
      const png = encodePng({
        width: recipe.imageSide,
        height: recipe.imageSide,
        fillRow: imageRow(role, recipe.imageSide, seed),
      });
      images.push({ bufferView: bufferViews.length, mimeType: 'image/png' });
      bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: png.length });
      const padded = aligned(png.length);
      pieces.push(png, Buffer.alloc(padded - png.length));
      offset += padded;
    }
  }

  const primitives = Array.from({ length: recipe.primitives }, (_, index) => index);
  const json: GltfJson = {
    asset: { version: '2.0', generator: 'three-studio tools/perf' },
    scene: 0,
    scenes: [{ nodes: primitives }],
    nodes: primitives.map((index) => ({
      name: `Quad ${index}`,
      mesh: index,
      translation: [(index - (recipe.primitives - 1) / 2) * 2.5, 1, 0],
    })),
    meshes: primitives.map((index) => {
      const primitive = { attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: index };
      return { name: `Quad ${index}`, primitives: [primitive] };
    }),
    materials: primitives.map((index) => ({
      name: `Textured ${index}`,
      pbrMetallicRoughness: {
        baseColorTexture: { index: index * 3 },
        metallicRoughnessTexture: { index: index * 3 + 2 },
        metallicFactor: 1,
        roughnessFactor: 1,
      },
      normalTexture: { index: index * 3 + 1 },
    })),
    textures: images.map((_, source) => ({ sampler: 0, source })),
    samplers: [{}],
    images,
    accessors,
    bufferViews,
    buffers: [{ byteLength: offset }],
  };
  return { json, bin: Buffer.concat(pieces) };
}
