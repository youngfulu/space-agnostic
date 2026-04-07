/**
 * Device detection helpers.
 * Pure function version that accepts explicit parameters for testability.
 */

export function isMobileDevice(innerWidth, hasTouchStart) {
    return innerWidth < 768 || hasTouchStart;
}

export function getViewportSize(visualViewport, innerWidth, innerHeight) {
    if (visualViewport) {
        return { width: visualViewport.width, height: visualViewport.height };
    }
    return { width: innerWidth, height: innerHeight };
}
