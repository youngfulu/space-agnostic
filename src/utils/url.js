/**
 * URL/path helpers for image loading.
 * Accepts explicit parameters instead of reading globals, for testability.
 */

export function getImageUrl(imagePath, useThumb, imageBase, origin) {
    const subPath = imageBase
        ? imagePath.replace(/^final images\/+/, '')
        : imagePath;
    const pathForUrl = useThumb ? 'thumb/' + subPath : subPath;
    const encoded = pathForUrl
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/');
    const prefix = imageBase ? String(imageBase).replace(/\/+$/, '') : '';
    const sep = prefix && !prefix.startsWith('/') ? '/' : '';
    return (origin || '') + (prefix ? sep + prefix + '/' : '/') + encoded;
}

export function ensureImageBase(pathname) {
    if (!pathname || !pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes(':')) {
        return '/img';
    }
    if (pathname === '/' || pathname === '') return '/img';
    const match = pathname.match(/^(.+\/)\.?/);
    const base = match ? match[1] : '/';
    return base.replace(/\/$/, '') + '/img';
}
