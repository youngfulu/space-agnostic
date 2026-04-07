import { describe, it, expect } from 'vitest';
import { easeOutExpoInertia, easeOutLog, easeOutCubic } from '../src/utils/easing.js';
import {
    getTouchDistance,
    getTouchMidpoint,
    getBoundingBox,
    lineIntersection,
    calculateImageDrawDimensions,
} from '../src/utils/geometry.js';
import { deriveTagsFromFolderName, getFolderTags, FOLDER_TAGS } from '../src/utils/tags.js';
import { getImageUrl, ensureImageBase } from '../src/utils/url.js';
import { isMobileDevice, getViewportSize } from '../src/utils/device.js';

// ─── Easing ──────────────────────────────────────────────────────────────────

describe('easeOutExpoInertia', () => {
    it('returns 0-ish at t=0', () => {
        expect(easeOutExpoInertia(0)).toBeCloseTo(0, 1);
    });
    it('returns 1 at t=1', () => {
        expect(easeOutExpoInertia(1)).toBe(1);
    });
    it('returns 1 for t>1', () => {
        expect(easeOutExpoInertia(2)).toBe(1);
    });
    it('is monotonically increasing (0→1) within tolerance', () => {
        let prev = easeOutExpoInertia(0);
        for (let t = 0.05; t <= 1; t += 0.05) {
            const cur = easeOutExpoInertia(t);
            expect(cur).toBeGreaterThanOrEqual(prev - 0.03);
            prev = cur;
        }
    });
    it('values stay within [0, 1.05] (slight overshoot allowed)', () => {
        for (let t = 0; t <= 1; t += 0.01) {
            const v = easeOutExpoInertia(t);
            expect(v).toBeGreaterThanOrEqual(-0.01);
            expect(v).toBeLessThanOrEqual(1.05);
        }
    });
});

describe('easeOutLog', () => {
    it('returns 0 at t=0', () => {
        expect(easeOutLog(0)).toBeCloseTo(0, 5);
    });
    it('returns 1 at t=1', () => {
        expect(easeOutLog(1)).toBeCloseTo(1, 5);
    });
    it('is monotonically increasing', () => {
        let prev = easeOutLog(0);
        for (let t = 0.1; t <= 1; t += 0.1) {
            const cur = easeOutLog(t);
            expect(cur).toBeGreaterThan(prev);
            prev = cur;
        }
    });
});

describe('easeOutCubic', () => {
    it('returns 0 at t=0', () => {
        expect(easeOutCubic(0)).toBe(0);
    });
    it('returns 1 at t=1', () => {
        expect(easeOutCubic(1)).toBe(1);
    });
    it('returns 1 for t>1', () => {
        expect(easeOutCubic(5)).toBe(1);
    });
    it('is monotonically increasing', () => {
        let prev = 0;
        for (let t = 0.05; t <= 1; t += 0.05) {
            const cur = easeOutCubic(t);
            expect(cur).toBeGreaterThanOrEqual(prev);
            prev = cur;
        }
    });
    it('values stay within [0, 1]', () => {
        for (let t = 0; t <= 1; t += 0.01) {
            const v = easeOutCubic(t);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });
});

// ─── Geometry ────────────────────────────────────────────────────────────────

describe('getTouchDistance', () => {
    it('returns 0 for same point', () => {
        const p = { clientX: 10, clientY: 20 };
        expect(getTouchDistance(p, p)).toBe(0);
    });
    it('calculates horizontal distance', () => {
        expect(getTouchDistance({ clientX: 0, clientY: 0 }, { clientX: 3, clientY: 4 })).toBe(5);
    });
});

describe('getTouchMidpoint', () => {
    it('returns midpoint of two touches', () => {
        const mid = getTouchMidpoint({ clientX: 0, clientY: 0 }, { clientX: 10, clientY: 20 });
        expect(mid).toEqual({ x: 5, y: 10 });
    });
});

describe('getBoundingBox', () => {
    it('desktop: full width, vertical margins', () => {
        const box = getBoundingBox(1200, 800, false);
        expect(box.x).toBe(0);
        expect(box.width).toBe(1200);
        expect(box.y).toBe(160);
        expect(box.height).toBe(480);
    });
    it('mobile: 3x width, centered offset', () => {
        const box = getBoundingBox(375, 667, true);
        expect(box.width).toBe(375 * 3);
        expect(box.x).toBe((375 - 375 * 3) / 2);
        expect(box.y).toBeCloseTo(667 / 5, 5);
    });
});

describe('lineIntersection', () => {
    it('finds intersection of crossing lines', () => {
        const pt = lineIntersection(0, 0, 10, 10, 0, 10, 10, 0, { x: 0, y: 0 });
        expect(pt.x).toBeCloseTo(5, 3);
        expect(pt.y).toBeCloseTo(5, 3);
    });
    it('returns fallback for parallel lines', () => {
        const fb = { x: 100, y: 200 };
        const pt = lineIntersection(0, 0, 10, 0, 0, 5, 10, 5, fb);
        expect(pt).toEqual(fb);
    });
    it('returns {0,0} for parallel lines with no fallback', () => {
        const pt = lineIntersection(0, 0, 10, 0, 0, 5, 10, 5);
        expect(pt).toEqual({ x: 0, y: 0 });
    });
});

describe('calculateImageDrawDimensions', () => {
    it('returns square for missing aspect ratio', () => {
        const d = calculateImageDrawDimensions(0, 100, false, null);
        expect(d).toEqual({ width: 100, height: 100 });
    });
    it('landscape: width = imageSize', () => {
        const d = calculateImageDrawDimensions(2, 100, false, null);
        expect(d.width).toBe(100);
        expect(d.height).toBe(50);
    });
    it('portrait: height = imageSize', () => {
        const d = calculateImageDrawDimensions(0.5, 100, false, null);
        expect(d.height).toBe(100);
        expect(d.width).toBe(50);
    });
    it('aligned mobile: scales from target dims', () => {
        const d = calculateImageDrawDimensions(1.5, 100, true, {
            isMobile: true,
            targetWidth: 300,
            targetHeight: 200,
            currentSize: 50,
            targetSize: 100,
        });
        expect(d.width).toBe(150);
        expect(d.height).toBe(100);
    });
});

// ─── Tags ────────────────────────────────────────────────────────────────────

describe('deriveTagsFromFolderName', () => {
    it('extracts #stage tag', () => {
        expect(deriveTagsFromFolderName('project #stage')).toEqual(['stage']);
    });
    it('extracts multiple tags', () => {
        const tags = deriveTagsFromFolderName('project #stage #tech');
        expect(tags).toContain('stage');
        expect(tags).toContain('tech');
    });
    it('handles #installation variations', () => {
        expect(deriveTagsFromFolderName('x #instalation')).toEqual(['installation']);
        expect(deriveTagsFromFolderName('x #instal')).toEqual(['installation']);
    });
    it('returns empty for no tags', () => {
        expect(deriveTagsFromFolderName('plain folder')).toEqual([]);
    });
    it('handles null/undefined', () => {
        expect(deriveTagsFromFolderName(null)).toEqual([]);
        expect(deriveTagsFromFolderName(undefined)).toEqual([]);
    });
});

describe('getFolderTags', () => {
    it('uses hashtag-derived tags first', () => {
        expect(getFolderTags('my project #spatial')).toEqual(['spatial']);
    });
    it('falls back to FOLDER_TAGS map', () => {
        expect(getFolderTags('2gis', FOLDER_TAGS)).toEqual(['spatial']);
    });
    it('strips hashtag suffix for fallback lookup', () => {
        expect(getFolderTags('Justice #old', FOLDER_TAGS)).toEqual(['stage']);
    });
    it('returns empty for unknown folder', () => {
        expect(getFolderTags('unknown_folder_xyz', FOLDER_TAGS)).toEqual([]);
    });
});

// ─── URL ─────────────────────────────────────────────────────────────────────

describe('getImageUrl', () => {
    it('builds URL with imageBase and origin', () => {
        const url = getImageUrl('final images/2gis/test.png', false, '/img', 'https://example.com');
        expect(url).toBe('https://example.com/img/2gis/test.png');
    });
    it('strips "final images/" prefix when imageBase is set', () => {
        const url = getImageUrl('final images/folder/pic.jpg', false, '/img', '');
        expect(url).toContain('/img/folder/pic.jpg');
        expect(url).not.toContain('final%20images');
    });
    it('adds thumb/ prefix when useThumb=true', () => {
        const url = getImageUrl('final images/f/a.png', true, '/img', '');
        expect(url).toContain('/img/thumb/');
    });
    it('encodes special characters in path segments', () => {
        const url = getImageUrl('final images/2gis  #spatial/14.png', false, '/img', '');
        expect(url).toContain('2gis%20%20%23spatial');
    });
    it('works without imageBase', () => {
        const url = getImageUrl('some/path/img.png', false, '', '');
        expect(url).toBe('/some/path/img.png');
    });
});

describe('ensureImageBase', () => {
    it('returns /img for root pathname', () => {
        expect(ensureImageBase('/')).toBe('/img');
    });
    it('returns /img for empty pathname', () => {
        expect(ensureImageBase('')).toBe('/img');
    });
    it('returns /img for null', () => {
        expect(ensureImageBase(null)).toBe('/img');
    });
    it('returns /repo/img for /repo/ pathname', () => {
        expect(ensureImageBase('/repo/')).toBe('/repo/img');
    });
    it('returns /4lights/img for /4lights/index.html', () => {
        expect(ensureImageBase('/4lights/index.html')).toBe('/4lights/img');
    });
    it('returns /img for protocol-like paths', () => {
        expect(ensureImageBase('http://x')).toBe('/img');
    });
});

// ─── Device ──────────────────────────────────────────────────────────────────

describe('isMobileDevice', () => {
    it('returns true for narrow viewport', () => {
        expect(isMobileDevice(375, false)).toBe(true);
    });
    it('returns true for touch device regardless of width', () => {
        expect(isMobileDevice(1920, true)).toBe(true);
    });
    it('returns false for wide desktop without touch', () => {
        expect(isMobileDevice(1920, false)).toBe(false);
    });
    it('returns true at boundary (767px)', () => {
        expect(isMobileDevice(767, false)).toBe(true);
    });
    it('returns false at boundary (768px)', () => {
        expect(isMobileDevice(768, false)).toBe(false);
    });
});

describe('getViewportSize', () => {
    it('uses visualViewport when available', () => {
        const vv = { width: 400, height: 700 };
        expect(getViewportSize(vv, 1024, 768)).toEqual({ width: 400, height: 700 });
    });
    it('falls back to innerWidth/innerHeight', () => {
        expect(getViewportSize(null, 1024, 768)).toEqual({ width: 1024, height: 768 });
    });
});
