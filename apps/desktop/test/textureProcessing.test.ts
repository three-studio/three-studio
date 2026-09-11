import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The cap on how large an image is allowed to be, and the two questions that
 * decide it.
 *
 * `nativeImage` is Chromium's decoder and cannot be run here, so it is replaced
 * by one that records what it was asked for. What is being checked is not that
 * Chromium can scale a JPEG — it can, measured: 471 ms to decode a 42 MB
 * 8192-square one, 60 ms to scale it, 1.77 MB out — but that this asks for the
 * right size, in the right format, and knows when to ask for nothing at all.
 */

const stub = vi.hoisted(() => ({
  calls: [] as { width: number; height: number; quality?: string }[],
  size: { width: 8192, height: 8192 },
  empty: false,
  encoded: [] as string[],
}));

vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: () => ({
      isEmpty: () => stub.empty,
      getSize: () => stub.size,
      resize: (options: { width: number; height: number; quality?: string }) => {
        stub.calls.push(options);
        return {
          toPNG: () => {
            stub.encoded.push('png');
            return Buffer.from('png');
          },
          toJPEG: (quality: number) => {
            stub.encoded.push(`jpeg:${quality}`);
            return Buffer.from('jpeg');
          },
        };
      },
    }),
  },
}));

const { imageFormatOf, processTexture, scaledSize } = await import(
  '../src/main/textureProcessing'
);

beforeEach(() => {
  stub.calls = [];
  stub.encoded = [];
  stub.size = { width: 8192, height: 8192 };
  stub.empty = false;
});

describe('the size to reduce to', () => {
  it('caps the longest side and keeps the shape', () => {
    // Unity's rule. Squaring everything to the cap instead would turn a trim
    // sheet into a stretched square.
    expect(scaledSize(8192, 8192, 2048)).toEqual({ width: 2048, height: 2048 });
    expect(scaledSize(4096, 512, 2048)).toEqual({ width: 2048, height: 256 });
    expect(scaledSize(512, 4096, 2048)).toEqual({ width: 256, height: 2048 });
  });

  it('says nothing for an image that already fits, which is most of them', () => {
    // `null` is "serve the source", not "something failed". Copying every
    // small image for nothing would double the project on disk.
    expect(scaledSize(1024, 1024, 2048)).toBeNull();
    expect(scaledSize(2048, 2048, 2048)).toBeNull();
  });

  it('never rounds a side away entirely', () => {
    // A 16384x3 strip: three pixels scaled by 1/8 rounds to zero, and an image
    // of no height is not an image.
    expect(scaledSize(16384, 3, 2048)).toEqual({ width: 2048, height: 1 });
  });

  it('refuses to divide by a size of nothing', () => {
    expect(scaledSize(0, 0, 2048)).toBeNull();
    expect(scaledSize(4096, 4096, 0)).toBeNull();
  });
});

describe('the format to write back', () => {
  it('recognises the two Chromium will both read and write', () => {
    expect(imageFormatOf('bark.PNG')).toBe('png');
    expect(imageFormatOf('bark.jpeg')).toBe('jpeg');
    expect(imageFormatOf('image/jpeg')).toBe('jpeg');
  });

  it('leaves alone what it would damage or cannot write', () => {
    // An HDR stores light rather than pixels, so re-encoding it as either of
    // those destroys what it is for; a KTX2 is already compressed for a GPU;
    // and `nativeImage` will not write WebP back.
    expect(imageFormatOf('sky.hdr')).toBeNull();
    expect(imageFormatOf('sky.exr')).toBeNull();
    expect(imageFormatOf('bark.ktx2')).toBeNull();
    expect(imageFormatOf('bark.webp')).toBeNull();
  });
});

describe('processing an image', () => {
  it('scales an oversized one and writes it back in its own format', () => {
    expect(processTexture(Buffer.from('x'), 'jpeg', 2048)).toEqual(Buffer.from('jpeg'));
    expect(stub.calls).toEqual([{ width: 2048, height: 2048, quality: 'good' }]);
    expect(stub.encoded).toEqual(['jpeg:90']);
  });

  it('keeps PNG as PNG, because that is where the alpha is', () => {
    processTexture(Buffer.from('x'), 'png', 2048);
    expect(stub.encoded).toEqual(['png']);
  });

  it('does not touch an image already under the cap', () => {
    stub.size = { width: 1024, height: 1024 };
    expect(processTexture(Buffer.from('x'), 'jpeg', 2048)).toBeNull();
    expect(stub.calls).toEqual([]);
  });

  it('gives up quietly on bytes that do not decode', () => {
    // An import that fails because one image was awkward is far worse than a
    // texture that stays large.
    stub.empty = true;
    expect(processTexture(Buffer.from('not an image'), 'png', 2048)).toBeNull();
  });
});
