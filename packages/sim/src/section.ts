export const SECTION_SIZE = 32;
export const SECTION_VOLUME = 32768;
export const sectionKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
export const columnKey = (x: number, z: number) => `${x},${z}`;
export const cellIndex = (x: number, y: number, z: number) => (y * 32 + z) * 32 + x;
export const gridIndex = (cx: number, sy: number, cz: number) => (sy * 64 + cz + 32) * 64 + cx + 32;
/** Dense address directory, sparse section allocations. Avoid strings in cell reads. */
export class SectionMap extends Map<string, Section> {
  readonly grid: (Section | undefined)[] = new Array(24576);
  override set(key: string, value: Section): this {
    const [x,y,z] = key.split(",").map(Number); this.grid[gridIndex(x,y,z)] = value;
    return super.set(key,value);
  }
  override delete(key: string): boolean {
    const [x,y,z] = key.split(",").map(Number); this.grid[gridIndex(x,y,z)] = undefined;
    return super.delete(key);
  }
}

/** Uniform sections have no index allocation. Indices never straddle a word. */
export class Section {
  palette: number[] = [0];
  bits = 0;
  words = new Uint32Array(0);
  nonAir = 0;
  revision = 0;
  private lookup = new Map<number, number>([[0, 0]]);
  get(i: number): number {
    if (!this.bits) return this.palette[0];
    const perWord = Math.floor(32 / this.bits);
    return this.palette[(this.words[Math.floor(i / perWord)] >>> ((i % perWord) * this.bits)) & ((1 << this.bits) - 1)];
  }
  set(i: number, state: number): boolean {
    if (!Number.isInteger(state) || state < 0 || state > 65535) throw new Error("Invalid 16-bit block state");
    const old = this.get(i);
    if (old === state) return false;
    let index = this.lookup.get(state);
    if (index === undefined) {
      index = this.palette.length;
      this.lookup.set(state, index);
      this.palette.push(state);
      const bits = Math.ceil(Math.log2(this.palette.length));
      if (bits !== this.bits) {
        const oldBits = this.bits, oldWords = this.words;
        const oldPerWord = oldBits ? Math.floor(32 / oldBits) : 0;
        const perWord = Math.floor(32 / bits);
        this.words = new Uint32Array(Math.ceil(SECTION_VOLUME / perWord));
        for (let n = 0; n < SECTION_VOLUME; n++) {
          const value = oldBits ? (oldWords[Math.floor(n / oldPerWord)] >>> ((n % oldPerWord) * oldBits)) & ((1 << oldBits) - 1) : 0;
          this.words[Math.floor(n / perWord)] |= value << ((n % perWord) * bits);
        }
        this.bits = bits;
      }
    }
    const perWord = Math.floor(32 / this.bits), shift = (i % perWord) * this.bits, word = Math.floor(i / perWord);
    this.words[word] = (this.words[word] & ~(((1 << this.bits) - 1) << shift)) | (index << shift);
    this.nonAir += (state ? 1 : 0) - (old ? 1 : 0);
    this.revision++;
    return true;
  }
  static fromCells(cells: Uint16Array): Section {
    const section = new Section();
    const palette = [...new Set(cells)];
    section.palette = palette;
    section.lookup = new Map(palette.map((v, i) => [v, i]));
    section.bits = Math.ceil(Math.log2(palette.length));
    const perWord = section.bits ? Math.floor(32 / section.bits) : 0;
    section.words = new Uint32Array(perWord ? Math.ceil(SECTION_VOLUME / perWord) : 0);
    for (let i = 0; i < cells.length; i++) {
      if (cells[i]) section.nonAir++;
      if (perWord) section.words[Math.floor(i / perWord)] |= section.lookup.get(cells[i])! << ((i % perWord) * section.bits);
    }
    return section;
  }
  cells(): Uint16Array {
    const cells=new Uint16Array(SECTION_VOLUME);
    if(!this.bits) { cells.fill(this.palette[0]); return cells; }
    for(let i=0;i<SECTION_VOLUME;i++) cells[i]=this.get(i);
    return cells;
  }
}

/** Canonical palette and RLE, little endian, independent of palette insertion order. */
const encoded = new WeakMap<Section,{revision:number;bytes:Uint8Array}>();
export function encodeSection(section: Section): Uint8Array {
  const cached=encoded.get(section); if(cached?.revision===section.revision) return cached.bytes;
  const cells = section.cells(), palette = [...new Set(cells)].sort((a, b) => a - b);
  const lookup = new Map(palette.map((v, i) => [v, i]));
  const runs: number[] = [];
  for (let i = 0; i < cells.length;) {
    const state = cells[i]; let end = i + 1;
    while (end < cells.length && cells[end] === state) end++;
    runs.push(end - i, lookup.get(state)!); i = end;
  }
  const bytes = new Uint8Array(4 + palette.length * 2 + runs.length * 2), view = new DataView(bytes.buffer);
  view.setUint32(0, palette.length, true);
  let offset = 4;
  for (const value of [...palette, ...runs]) { view.setUint16(offset, value, true); offset += 2; }
  encoded.set(section,{revision:section.revision,bytes}); return bytes;
}
export function decodeSection(bytes: Uint8Array): Section {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6) throw new Error("Truncated section");
  const count = view.getUint32(0, true);
  if (count < 1 || count > SECTION_VOLUME || 4 + count * 2 > bytes.length) throw new Error("Invalid palette");
  const palette = Array.from({ length: count }, (_, i) => view.getUint16(4 + i * 2, true));
  const cells = new Uint16Array(SECTION_VOLUME);
  let cursor = 0;
  for (let offset = 4 + count * 2; offset < bytes.length; offset += 4) {
    if (offset + 4 > bytes.length) throw new Error("Truncated run");
    const length = view.getUint16(offset, true), index = view.getUint16(offset + 2, true);
    if (!length || index >= count || cursor + length > SECTION_VOLUME) throw new Error("Invalid run");
    cells.fill(palette[index], cursor, cursor + length); cursor += length;
  }
  if (cursor !== SECTION_VOLUME) throw new Error("Incomplete section");
  return Section.fromCells(cells);
}
