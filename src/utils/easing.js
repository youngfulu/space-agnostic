/**
 * Easing functions for animations.
 * Kept pure (no side effects, no global dependencies) for testability.
 */

export function easeOutExpoInertia(t) {
    if (t >= 1) return 1;
    const expo = 1 - Math.pow(2, -10 * t);
    const overshoot = 0.02;
    const settle = Math.sin(t * Math.PI) * overshoot * (1 - t);
    return expo + settle;
}

export function easeOutLog(t) {
    return Math.log(1 + t * (Math.E - 1));
}

export function easeOutCubic(t) {
    if (t >= 1) return 1;
    return 1 - Math.pow(1 - t, 3);
}
