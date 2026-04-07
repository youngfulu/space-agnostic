/**
 * Pure geometry helpers (no DOM/global dependencies).
 */

export function getTouchDistance(t1, t2) {
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

export function getTouchMidpoint(t1, t2) {
    return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
    };
}

export function getBoundingBox(canvasWidth, canvasHeight, isMobile) {
    const margin = canvasHeight / 5;
    let width = canvasWidth;
    if (isMobile) width = canvasWidth * 3;
    const offsetX = isMobile ? (canvasWidth - width) / 2 : 0;
    return {
        x: offsetX,
        y: margin,
        width,
        height: canvasHeight - margin * 2,
    };
}

/**
 * Line–line intersection.  Returns the intersection point (possibly extended
 * beyond the segments). If lines are parallel, returns the fallback point.
 */
export function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4, fallback) {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 0.001) {
        return fallback || { x: 0, y: 0 };
    }
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    return {
        x: x1 + t * (x2 - x1),
        y: y1 + t * (y2 - y1),
    };
}

export function calculateImageDrawDimensions(aspectRatio, imageSize, isAligned, alignedInfo) {
    if (!aspectRatio || aspectRatio <= 0) {
        return { width: imageSize, height: imageSize };
    }

    if (isAligned && alignedInfo) {
        const { isMobile, targetWidth, targetHeight, currentSize, targetSize, targetImageWidth } = alignedInfo;
        if (isMobile && targetWidth !== undefined && targetHeight !== undefined) {
            const scale = currentSize / targetSize;
            return { width: targetWidth * scale, height: targetHeight * scale };
        }
        if (targetImageWidth !== undefined) {
            return { width: currentSize * aspectRatio, height: currentSize };
        }
        if (aspectRatio >= 1) {
            const w = currentSize || imageSize;
            return { width: w, height: w / aspectRatio };
        }
        const h = currentSize || imageSize;
        return { width: h * aspectRatio, height: h };
    }

    if (aspectRatio >= 1) {
        return { width: imageSize, height: imageSize / aspectRatio };
    }
    return { width: imageSize * aspectRatio, height: imageSize };
}
