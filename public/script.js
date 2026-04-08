// Set __IMAGE_BASE__ from pathname so deployed (e.g. GitHub Pages) gets correct /repo/img; run before any image load
function ensureImageBase() {
    if (typeof window === 'undefined') return;
    if (window.__IMAGE_BASE__ !== undefined && window.__IMAGE_BASE__ !== '') return;
    var pathname = (window.location && window.location.pathname) || '';
    if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.indexOf(':') !== -1) {
        window.__IMAGE_BASE__ = '/img';
        return;
    }
    if (pathname === '/' || pathname === '') {
        window.__IMAGE_BASE__ = '/img';
        return;
    }
    var match = pathname.match(/^(.+\/)\.?/);
    var base = match ? match[1] : '/';
    var baseNoTrailing = base.replace(/\/$/, '') || '';
    window.__IMAGE_BASE__ = baseNoTrailing + '/img';
}
ensureImageBase();

// Locale for about text (EN/FR) - about.js defines ABOUT_TEXT and ABOUT_TEXT_FR
if (typeof window !== 'undefined') {
    window.__LOCALE__ = window.__LOCALE__ || 'en';
}
function getAboutText() {
    return (typeof window !== 'undefined' && window.__LOCALE__ === 'fr' && typeof ABOUT_TEXT_FR !== 'undefined')
        ? ABOUT_TEXT_FR : (typeof ABOUT_TEXT !== 'undefined' ? ABOUT_TEXT : '');
}

// Helper: return mobile UI to main/home state
function mobileReturnHome() {
    // Close category overlay if open
    if (currentMobileCategory !== null) {
        handleMobileCategoryBack();
    }
    
    // Clear any modes
    if (isWeAreMode) {
        clearWeAreMode();
    }
    if (isFilterMode) {
        clearFilter();
    }
    if (isConnectionMode) {
        exitConnectionMode();
    }
    if (alignedEmojiIndex !== null) {
        unalignEmojis();
    }
    
    // Ensure mobile nav and grid are visible
    const mobileNav = document.getElementById('mobileHomepageNav');
    if (mobileNav) {
        mobileNav.classList.add('visible');
    }
    const canvasEl = document.getElementById('canvas');
    if (canvasEl) {
        canvasEl.classList.remove('mobile-grid-fade-out');
    }
    
    updateBackButtonVisibility();
    updateMobileGridPointerState();
    startMobileAutoConnections();
}

function updateMobileGridPointerState() {
    if (!canvas) return;
    // Keep gestures active for panning; selection/tap is blocked in handlers
    canvas.style.pointerEvents = 'auto';
}

function stopMobileAutoConnections() {
    mobileAutoEnabled = false;
    mobileAutoLines = [];
    mobileAutoFolders = [];
    mobileAutoFolderProgress.clear();
    mobileAutoFolderIndex = 0;
    mobileAutoNextAddTime = 0;
    mobileAutoLastFolderSwitch = 0;
}

function startMobileAutoConnections() {
    if (!isMobileVersion) return;
    mobileAutoEnabled = true;
    mobileAutoNextAddTime = performance.now();
    mobileAutoLastFolderSwitch = 0;
    rebuildMobileAutoFolders();
}
// Canvas initialization - check if element exists
const canvas = document.getElementById('canvas');
if (!canvas) {
    console.error('Canvas element not found! Make sure the canvas element exists in the HTML.');
    // Don't throw - let the page load and show error in console
}
const ctx = canvas ? canvas.getContext('2d') : null;
if (!ctx && canvas) {
    console.error('Could not get 2d context from canvas!');
}

// Performance/debug flags
const DEBUG = false;
const IMAGE_LOAD_CONCURRENCY = 10; // More parallel loads so all grid images finish loading
const INITIAL_IMAGES_TO_LOAD = 24; // Load more thumbs quickly for faster first paint
const MAX_LOADING_SCREEN_WAIT_MS = 120000; // Only for real hangs (2 min); do not pass to home until all images loaded
const APP_START_TIME = performance.now();

function debugLog(...args) {
    if (DEBUG) console.log(...args);
}

// Set canvas size
function resizeCanvas() {
    if (!canvas) {
        console.error('Canvas not initialized in resizeCanvas');
        return;
    }
    const { width, height } = getViewportSize();
    canvas.width = width;
    canvas.height = height;
}
// Only resize if canvas is available (single initial run; resize handler is in runAppInit with rAF debounce)
if (canvas) {
resizeCanvas();
}

// Emoji size settings - MUST be declared before use
const baseEmojiSize = 96; // Base size for layer_1 (4x larger: 24 * 4 = 96)
const layer2SizeMultiplier = 1 / 1.6; // Layer_2 is 1.6 times smaller
const hoverZoom = 1.0 + (2.0 - 1.0) / 3.0; // Zoom factor on hover (smaller zoom in: 1.33x instead of 2.0x)
const hoverZoomTransitionDuration = 500; // Transition duration in milliseconds (0.5 seconds)
const alignmentAnimationDuration = 1200; // Animation duration in milliseconds (1.2 seconds - matches phase 1)
const alignedSizeMultiplier = 7.0; // Size multiplier when aligned (7x larger)
const panSmoothness = 0.09; // Smoothness factor for camera pan interpolation (2x slower for smoother feel)
const SELECTION_PAN_SMOOTHNESS = 0.045; // Slower, smoother pan in image selection mode (next/prev)
const SELECTION_PAN_INERTIA_DECAY = 0.96; // Slight inertia decay in selection mode (smoother follow-through)
// Opacity transition: fade to 0 (invisible) in 1 second (2x slower, linear interpolation)
// Linear fade: current += (target - current) * smoothness
// To reach ~0.01 in 1 second (60 frames) with linear interpolation: smoothness ≈ 0.017
// Using 0.08 for smoother linear fade (2x slower than before)
const opacitySmoothness = 0.08; // Linear fade: ~1 second at 60fps (2x slower)
const INDEX_MODE_FADE_SPEED = 0.04; // Slower fade for index mode: ~2 seconds at 60fps

// Mouse/touch position
let mouseX = canvas ? canvas.width / 2 : window.innerWidth / 2;
let mouseY = canvas ? canvas.height / 2 : window.innerHeight / 2;
let targetMouseX = mouseX;
let targetMouseY = mouseY;

// Smooth mouse tracking
let smoothMouseX = mouseX;
let smoothMouseY = mouseY;

// Track if mouse is currently over the canvas (for hover detection)
let mouseOverCanvas = true;

// Camera zoom - 3 discrete levels: far away, medium (loading screen), close up
const zoomLevels = [0.75, 1.0, 2.0]; // Far away (1.5x closer), medium (same as loading screen), close up
let currentZoomIndex = 1; // Start at medium level (1.0)
let globalZoomLevel = 1.0;
let targetZoomLevel = 1.0;
const minZoom = 0.75;
const maxZoom = 2.0;
const zoomTransitionDuration = 1500; // 1.5 seconds in milliseconds
let zoomTransitionStartTime = 0;
let zoomTransitionStartLevel = 1.0;
let zoomTransitionTargetLevel = 1.0;
let isZoomTransitioning = false;

// Camera pan (drag to move view) with inertia
let cameraPanX = 0;
let cameraPanY = 0;
let targetCameraPanX = 0;
let targetCameraPanY = 0;
let panVelocityX = 0; // Pan velocity for inertia
let panVelocityY = 0;
let isDragging = false;
let lastDragX = 0;
let lastDragY = 0;
let lastMoveTime = performance.now();

// Store initial camera position for reset
const initialCameraPanX = 0;
const initialCameraPanY = 0;
const initialZoomIndex = 1; // Base zoom level index (medium = 1.0)

// Alignment state
let alignedEmojiIndex = null; // null = no alignment, otherwise the emoji index to align
let alignedEmojis = []; // Array of emoji objects that are currently aligned
let alignedFolderPath = null; // Folder currently aligned (used for relayout as images load)
let alignedRowTotalWidthWorld = 0; // Total width of horizontal row (world units) for infinite carousel
let selectionBasePanX = 0; // Base pan X when entering selection (for carousel wrap)
let alignedRelayoutRaf = 0;

// Selection mode carousel: auto-scroll left-to-right 60px/sec (web only); pause on mousedown, resume on mouseup
const CAROUSEL_AUTO_SCROLL_SPEED = 60; // px/sec
let carouselAutoScrollPaused = false;
let lastDrawTimeForCarousel = 0;

// Mobile nav visibility helper (buttons/lines)
function setMobileNavVisibility(visible) {
    const mobileNav = document.getElementById('mobileHomepageNav');
    if (!mobileNav) return;
    const labels = mobileNav.querySelectorAll('.mobile-nav-label');
    if (visible) {
        mobileNav.classList.add('visible');
        mobileNav.style.opacity = '1';
        // Container: none so touches pass through to canvas for pan; only labels are clickable
        mobileNav.style.pointerEvents = 'none';
        labels.forEach(function (el) { el.style.pointerEvents = 'auto'; });
    } else {
        mobileNav.classList.remove('visible');
        mobileNav.style.opacity = '0';
        mobileNav.style.pointerEvents = 'none';
        labels.forEach(function (el) { el.style.pointerEvents = 'none'; });
    }
}

// Reset mobile selection state: restore original positions/opacities
function resetMobileSelectionLayout() {
    alignedEmojiIndex = null;
    alignedEmojis = [];
    points.forEach(p => {
        p.isAligned = false;
        p.isInactive = false;
        p.targetOpacity = 1.0;
        p.targetX = p.originalBaseX;
        p.targetY = p.originalBaseY;
        p.targetSize = p.layer === 'layer_1' ? baseEmojiSize : baseEmojiSize * layer2SizeMultiplier;
        p.targetWidth = undefined;
        p.targetHeight = undefined;
        p.alignmentStartTime = 0;
    });
}

// Selection animation state (desktop only):
// Phase 1: Zoom out + images move to grid + others fade out (1.2s)
// Phase 1.5: Delay (0.25s)
// Phase 2: Zoom in to leftmost image (1.2s)
// Phase -1: Reverse - zoom out to show full grid + images start moving back (1.2s)
// Phase -2: Reverse - zoom to 1.0 + images finish moving back (1.2s)
let selectionAnimationPhase = 0;
let selectionPhaseStartTime = 0;
const SELECTION_PHASE1_DURATION = 1200; // 1.2 seconds for phase 1
const SELECTION_PHASE_DELAY = 250; // 0.25 seconds delay between phase 1 and 2
const SELECTION_PHASE2_DURATION = 1140; // ~5% faster than 1200ms for pan to final carousel position
let selectionStartZoom = 1.0;
let selectionTargetZoomOut = 1.0;
let selectionTargetZoomIn = 1.0;
let selectionStartPanX = 0;
let selectionStartPanY = 0;
let selectionZoomOutPanX = 0;
let selectionFinalPanX = 0;
let selectionZoomOutExit = 1.0; // Zoom level for exit phase -1 (20% closer than selectionTargetZoomOut)
// Point to focus on in phase 2: if set (from grid click), pan to it; if null (from menu), pick center-closest
let selectionFocusPointForPhase2 = null;
let selectionFocusIndexStored = null; // preserved for relayout so pan does not jump

// Smoothed Y positions for desktop about block (avoids jitter during phase 2 / phase 0 transition)
let aboutSmoothedNameBottomPx = null;
let aboutSmoothedInfoTopPx = null;
let aboutSmoothedMoreTopPx = null;
// After selection animation completes: fix about/more block X; only Y follows images
let selectionAboutFixedLeftPx = null;
let selectionMoreFixedLeftPx = null;
// True once we've started phase 1 for this alignment; prevents relayout-after-load from restarting animation
let selectionAnimationHasRunForCurrentAlignment = false;

// Exponential easing with tiny inertia at the end for natural, smooth feel
// Overshoots slightly then settles back
function easeOutExpoInertia(t) {
    if (t >= 1) return 1;
    // Exponential ease out
    const expo = 1 - Math.pow(2, -10 * t);
    // Add tiny overshoot and settle (about 2% overshoot)
    const overshoot = 0.02;
    const settle = Math.sin(t * Math.PI) * overshoot * (1 - t);
    return expo + settle;
}

// Logarithmic easing function - starts fast, slows down gradually
function easeOutLog(t) {
    const e = Math.E;
    return Math.log(1 + t * (e - 1)) / Math.log(e);
}

// Softer easing for phase 2 pan (10% smoother than expo)
function easeOutCubic(t) {
    if (t >= 1) return 1;
    return 1 - Math.pow(1 - t, 3);
}


// Viewport helper (handles iOS visual viewport sizing)
function getViewportSize() {
    const vv = window.visualViewport;
    if (vv) {
        return { width: vv.width, height: vv.height };
    }
    return { width: window.innerWidth, height: window.innerHeight };
}

// Zoom velocity for light inertia-based zoom
let zoomVelocity = 0;
let lastWheelTime = 0; // Track time between wheel events for inertia

// Protection against accidental clicks while navigating/zooming
let lastInteractionTime = 0; // Track last navigation/zoom interaction
const CLICK_DELAY_AFTER_INTERACTION = 150; // Delay in ms before allowing clicks after navigation/zoom (desktop)
const MOBILE_CLICK_COOLDOWN = 500; // 0.5 sec cooldown for mobile to prevent accidental clicks during navigation
let lastMobileClickTime = 0; // Track last click time on mobile
const MOBILE_INITIAL_CLICK_DELAY = 2000; // 2 seconds delay after home screen loads (mobile only)
let mobileInitialLoadTime = null; // Time when home screen finished loading (mobile only)
const MOBILE_SELECTION_MODE_DELAY = 2000; // 2 seconds window to enter selection mode after first click
let mobileFirstClickTime = 0; // Time when first click (connection mode) was registered


// Hover timeout state (for fade out unrelated images after 2 seconds)
let hoveredPoint = null; // Currently hovered point
let hoverStartTime = 0; // When hover started
const HOVER_FADE_TIMEOUT = 1000; // 1 second in milliseconds (mobile)
const HOVER_FADE_TIMEOUT_WEB = 175; // 0.175s for dotted line to appear (web only)
let hoveredConnectedPoints = []; // Points connected by arrows on hover
let hoveredLinesOpacity = 0.0; // Opacity of connection lines on hover
const HOVER_FADE_IN_SPEED = 0.08; // Linear fade in/out: ~1 second at 60fps (2x slower than before) - mobile
const HOVER_FADE_IN_SPEED_WEB = 0.16; // 2x faster for web (desktop)

// Track whether the user has interacted to prevent auto-hover fading on load
let hasUserInteracted = false;
function markUserInteracted() {
    if (!hasUserInteracted) {
        hasUserInteracted = true;
    }
}

// Mobile selection mode layout constants
const MOBILE_SELECTION_LEFT_MARGIN = 35; // 35px from left edge
const MOBILE_SELECTION_VERTICAL_GAP = 35; // 35px gap between images vertically
const MOBILE_SELECTION_TOP_PADDING = 80; // 80px top padding
const MOBILE_SELECTION_MAX_WIDTH_PERCENT = 0.65; // Max 65% of screen width

// Fade out animation constants
const FADE_OUT_DURATION_MS = 250; // 250ms fade out duration for selection mode
const FPS = 60; // Target frame rate
// Calculate speed for linear interpolation: opacity += (target - current) * speed
// To reach target in N frames: speed = 1 / N, where N = duration_ms / frame_time_ms
// N = 250ms / (1000ms/60fps) = 15 frames, so speed = 1/15 ≈ 0.067
const FADE_OUT_SPEED = 1 / (FADE_OUT_DURATION_MS / (1000 / FPS)); // ≈ 0.067 for 250ms at 60fps

// Mobile grid fade out constants
const MOBILE_GRID_FADE_OUT_DURATION_MS = 300; // 0.3 seconds for mobile grid fade out
const MOBILE_GRID_FADE_OUT_SPEED = 1 / (MOBILE_GRID_FADE_OUT_DURATION_MS / (1000 / FPS)); // ≈ 0.056 for 300ms at 60fps

// Mobile version state
let isMobileVersion = false;
let currentMobileCategory = null;
let allowMobileAutoConnection = false;
let mobileAutoConnectionTimer = null;
let mobileAutoConnectionExitTimer = null;

// Mobile auto dotted-line animation (background, non-interactive)
const MOBILE_AUTO_LINE_MAX = 6;
const MOBILE_AUTO_LINE_DURATION = 6000; // 2s fade in + 4s fade out
const MOBILE_AUTO_LINE_FADE_IN = 250;
const MOBILE_AUTO_LINE_FADE_OUT = 250;
const MOBILE_AUTO_ADD_INTERVAL = 1200; // one-by-one
const MOBILE_AUTO_FOLDER_CROSSFADE = 2000;
let mobileAutoEnabled = false;
let mobileAutoNextAddTime = 0;
let mobileAutoLastFolderSwitch = 0;
let mobileAutoFolders = [];
let mobileAutoFolderIndex = 0;
let mobileAutoFolderProgress = new Map(); // folderPath -> edge index
let mobileAutoLines = []; // {from, to, start, end, folder}

// Pre-calculated connection trajectories for all folders (calculated during loading)
let precomputedConnectionTrajectories = new Map(); // Map<folderPath, { points: Array, sorted: boolean }>

// Connection mode state (dotted lines connecting images)
let isConnectionMode = false; // Whether we're in connection mode
let connectedPoints = []; // Points that are connected by lines
let connectedFolderPath = null; // Folder path for connected images
let mobileLastTappedPoint = null; // Track last tapped point on mobile for two-tap behavior
let isConnectionModeClicked = false; // Whether connection mode was entered via click (true) or auto-hover (false)
let autoHoverTriggerPoint = null; // Track which point triggered auto-hover connection mode
// image_names: labels above images in connection (dotted line) mode. Set IMAGE_NAMES_ENABLED = true to re-enable.
const IMAGE_NAMES_ENABLED = false;
let connectionModeLabelsOpacity = 0;
let connectionModeLabelsFadeStartTime = 0;
let connectionModeLabelsFadeIn = false;
let lastConnectedPointsForLabels = []; // Used during 0.1s fade-out after exit

function isMobileDevice() {
    return window.innerWidth < 768 || ('ontouchstart' in window);
}

// ---------- Mobile auto dotted-line animation (background, non-interactive) ----------
function rebuildMobileAutoFolders() {
    const folderMap = new Map();
    points.forEach(p => {
        const folder = p.folderPath || p.imagePath.substring(0, p.imagePath.lastIndexOf('/')) || 'Artsy';
        if (!folderMap.has(folder)) {
            folderMap.set(folder, []);
        }
        folderMap.get(folder).push(p);
    });
    mobileAutoFolders = Array.from(folderMap.entries())
        .filter(([folder]) => !folder.includes('/0_'))
        .filter(([, arr]) => arr.length > 1)
        .map(([folder, arr]) => {
            const sorted = [...arr].sort((a, b) => a.originalBaseX - b.originalBaseX || a.originalBaseY - b.originalBaseY);
            return { folder, points: sorted };
        });
    mobileAutoFolderIndex = 0;
    mobileAutoFolderProgress.clear();
    mobileAutoLines = [];
    mobileAutoNextAddTime = performance.now();
}

function updateMobileAutoLines(now) {
    const inMobileHome = isMobileVersion &&
        currentMobileCategory === null &&
        alignedEmojiIndex === null &&
        !isFilterMode &&
        !isConnectionMode &&
        !isWeAreMode;
    
    if (!mobileAutoEnabled || !isMobileVersion || !inMobileHome) {
        mobileAutoLines = [];
        return;
    }
    
    if (mobileAutoFolders.length === 0 && points.length > 0) {
        rebuildMobileAutoFolders();
    }
    
    // Drop expired
    mobileAutoLines = mobileAutoLines.filter(line => line.end > now);
    
    if (mobileAutoFolders.length === 0) return;
    if (now < mobileAutoNextAddTime) return;
    
    const folderEntry = mobileAutoFolders[mobileAutoFolderIndex % mobileAutoFolders.length];
    const folderKey = folderEntry.folder;
    const pts = folderEntry.points;
    if (!pts || pts.length < 2) {
        mobileAutoFolderIndex = (mobileAutoFolderIndex + 1) % mobileAutoFolders.length;
        mobileAutoNextAddTime = now + MOBILE_AUTO_ADD_INTERVAL;
        return;
    }
    
    const idx = mobileAutoFolderProgress.get(folderKey) || 0;
    const from = pts[idx % pts.length];
    const to = pts[(idx + 1) % pts.length];
    const start = now;
    const end = now + MOBILE_AUTO_LINE_DURATION;
    mobileAutoLines.push({ from, to, start, end, folder: folderKey });
    
    mobileAutoFolderProgress.set(folderKey, (idx + 1) % pts.length);
    if ((idx + 1) % pts.length === 0) {
        // Completed folder cycle: switch folder with crossfade pause
        mobileAutoFolderIndex = (mobileAutoFolderIndex + 1) % mobileAutoFolders.length;
        mobileAutoLastFolderSwitch = now;
        mobileAutoNextAddTime = now + MOBILE_AUTO_FOLDER_CROSSFADE;
    } else {
        mobileAutoNextAddTime = now + MOBILE_AUTO_ADD_INTERVAL;
    }
    
    // Enforce max concurrent lines: fade out oldest by shortening lifespan
    if (mobileAutoLines.length > MOBILE_AUTO_LINE_MAX) {
        const overflow = mobileAutoLines.length - MOBILE_AUTO_LINE_MAX;
        const sorted = [...mobileAutoLines].sort((a, b) => a.start - b.start);
        for (let i = 0; i < overflow; i++) {
            const line = sorted[i];
            line.end = Math.min(line.end, now + MOBILE_AUTO_LINE_FADE_OUT);
        }
    }
}

function drawMobileAutoLines(ctx, now) {
    if (!mobileAutoEnabled || mobileAutoLines.length === 0) return;
    
    ctx.save();
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    ctx.translate(centerX + cameraPanX, centerY + cameraPanY);
    ctx.scale(globalZoomLevel, globalZoomLevel);
    ctx.translate(-centerX, -centerY);
    
    mobileAutoLines.forEach(line => {
        const { from, to, start, end } = line;
        const imageData1 = imageCache[from.imagePath];
        const imageData2 = imageCache[to.imagePath];
        if (!imageData1 || !imageData2) return;
        
        const dims1 = calculateConnectionLineImageSize(from, imageData1);
        const dims2 = calculateConnectionLineImageSize(to, imageData2);
        
        const life = end - start;
        const elapsed = now - start;
        if (life <= 0 || elapsed < 0) return;
        const fadeIn = Math.min(1, Math.max(0, elapsed / MOBILE_AUTO_LINE_FADE_IN));
        const fadeOut = Math.min(1, Math.max(0, (end - now) / MOBILE_AUTO_LINE_FADE_OUT));
        const alpha = Math.min(fadeIn, fadeOut);
        if (alpha <= 0.01) return;
        
        ctx.globalAlpha = alpha;
        drawCurvedConnectionLine(ctx, from.originalBaseX, from.originalBaseY, to.originalBaseX, to.originalBaseY, dims1.width, dims1.height, dims2.width, dims2.height);
    });
    
    ctx.restore();
}
// Helper function to calculate image draw dimensions - reduces code duplication
function calculateImageDrawDimensions(point, imageData, imageSize) {
    if (!imageData || !imageData.aspectRatio) {
        return { width: imageSize, height: imageSize };
    }
    
    const aspectRatio = imageData.aspectRatio;
    let drawWidth, drawHeight;
    const isMobile = isMobileDevice();
    
    if (point.isAligned) {
        // For aligned images: check if mobile with equal max dimension scaling
        if (isMobile && point.targetWidth !== undefined && point.targetHeight !== undefined) {
            // Mobile: use stored targetWidth and targetHeight, scale by currentSize/targetSize ratio
            const scale = point.currentSize / point.targetSize;
            drawWidth = point.targetWidth * scale;
            drawHeight = point.targetHeight * scale;
        } else if (point.targetImageWidth !== undefined) {
            // Desktop: use currentSize (interpolated height) and calculate width from aspect ratio
        drawHeight = point.currentSize;
        drawWidth = drawHeight * aspectRatio;
        } else {
            // Fallback: use currentSize as the larger dimension
            if (aspectRatio >= 1) {
                drawWidth = point.currentSize || imageSize;
                drawHeight = drawWidth / aspectRatio;
            } else {
                drawHeight = point.currentSize || imageSize;
                drawWidth = drawHeight * aspectRatio;
            }
        }
    } else if (aspectRatio >= 1) {
        // Landscape or square: use imageSize as width
        drawWidth = imageSize;
        drawHeight = imageSize / aspectRatio;
    } else {
        // Portrait: use imageSize as height
        drawHeight = imageSize;
        drawWidth = imageSize * aspectRatio;
    }
    
    return { width: drawWidth, height: drawHeight };
}

// Helper function to calculate image size for connection lines - reduces code duplication
function calculateConnectionLineImageSize(point, imageData) {
    if (!imageData) return { width: 0, height: 0 };
    
    const aspectRatio = imageData.aspectRatio || 1;
    let size = point.layer === 'layer_1' ? baseEmojiSize : baseEmojiSize * layer2SizeMultiplier;
    
    // Account for hover zoom if applicable
    if (point.hoverSize !== undefined) {
        size = size * point.hoverSize;
    }
    
    let drawWidth, drawHeight;
    if (aspectRatio >= 1) {
        drawWidth = size;
        drawHeight = size / aspectRatio;
    } else {
        drawHeight = size;
        drawWidth = size * aspectRatio;
    }
    
    return { width: drawWidth, height: drawHeight };
}

function scheduleAlignedDesktopRelayoutIfNeeded(changedImagePath = null) {
    // Only matters for desktop horizontal alignment layout
    if (alignedEmojiIndex === null) return;
    if (isFilterMode) return; // filter mode has its own layout / transitions
    if (isMobileDevice()) return;
    if (!alignedEmojis || alignedEmojis.length === 0) return;

    if (changedImagePath) {
        const isInAlignedSet = alignedEmojis.some(p => p && p.imagePath === changedImagePath);
        if (!isInAlignedSet) return;
    }

    if (alignedRelayoutRaf) return;
    alignedRelayoutRaf = requestAnimationFrame(() => {
        alignedRelayoutRaf = 0;
        // Re-check state at execution time
        if (alignedEmojiIndex === null) return;
        if (isMobileDevice()) return;
        layoutAlignedEmojisDesktop(true);
    });
}

function layoutAlignedEmojisDesktop(animate = true) {
    if (alignedEmojiIndex === null) return;
    if (isMobileDevice()) return;
    if (!alignedEmojis || alignedEmojis.length === 0) return;

    loadFullResForPaths(alignedEmojis.map(p => p.imagePath));
    loadHighresForPaths(alignedEmojis.map(p => p.imagePath));
    const now = performance.now();
    // Desktop selection:
    // - Images have equal WIDTH (scale proportionally)
    // - Selection occupies the LEFT 2/3 of the screen
    // - Images scaled so row height = 2/5 of vertical screen space
    const horizontalGap = 35;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const regionLeft = 40;
    const regionRight = (canvas.width * 2) / 3 - 40;
    const regionWidth = Math.max(1, regionRight - regionLeft);
    const SELECTION_ROW_HEIGHT_FRACTION = (2 / 5) * 1.25; // row height = 2/5 of viewport, +25% min size
    const targetRowHeightScreen = canvas.height * SELECTION_ROW_HEIGHT_FRACTION;

    // Find max aspect ratio so we can cap width if row would overflow region
    let maxAspectRatio = 0;
    alignedEmojis.forEach(point => {
        const imageData = imageCache[point.imagePath];
        const ar = (imageData && imageData.aspectRatio) ? imageData.aspectRatio : 1;
        maxAspectRatio = Math.max(maxAspectRatio, ar > 0 ? ar : 1);
    });
    // Use 2/5 of screen height; scale down only if row would exceed region width
    const targetHeightScreen = Math.min(targetRowHeightScreen, regionWidth / maxAspectRatio);
    const targetHeightWorld = targetHeightScreen; // zoom=1 baseline; we will zoom out if needed

    const imageHeights = [];
    const imageWidths = [];

    // Compute dimensions (kick off loads for any missing images)
    alignedEmojis.forEach(point => {
        const imageData = imageCache[point.imagePath];
        const aspectRatio = (imageData && imageData.aspectRatio) ? imageData.aspectRatio : 1;

        // If missing, request full-res load so we can relayout when it arrives
        if (!imageData) {
            loadImageWithRetry(point.imagePath, 2, false).then(() => {
                scheduleAlignedDesktopRelayoutIfNeeded(point.imagePath);
            }).catch(() => {});
        }

        const safeAR = aspectRatio > 0 ? aspectRatio : 1;
        const imageHeight = targetHeightWorld; // equal height for all selected images
        const imageWidth = imageHeight * safeAR; // proportional width

        imageHeights.push(imageHeight);
        imageWidths.push(imageWidth);
    });

    const totalWidth = imageWidths.reduce((sum, width) => sum + width, 0) + (alignedEmojis.length - 1) * horizontalGap;
    const totalWidthWithSideGaps = totalWidth + 2 * horizontalGap;
    // Carousel period = totalWidth + horizontalGap so gap between last and (wrapped) first = horizontalGap
    alignedRowTotalWidthWorld = totalWidth + horizontalGap;
    // Same gap left of first and right of last as between images: row centered with side margins
    const firstImageLeftEdge = centerX - totalWidthWithSideGaps / 2 + horizontalGap;
    let startX = firstImageLeftEdge;
    const worldLeftEdge = firstImageLeftEdge;

    // Check if this is a NEW alignment or a relayout (relayout after images load must not restart animation)
    const isNewAlignment = selectionAnimationPhase === 0 && !selectionAnimationHasRunForCurrentAlignment;

    alignedEmojis.forEach((point, index) => {
        const imageWidth = imageWidths[index];
        const imageHeight = imageHeights[index];

        point.isAligned = true;
        point.targetX = startX + imageWidth / 2;
        point.targetY = centerY;
        point.targetSize = imageHeight;
        point.targetImageWidth = imageWidth; // used as width in draw; height is the targetSize
        point.targetOpacity = 1.0;

        if (animate && isNewAlignment) {
            // NEW alignment - start from original grid position
            point.startX = point.originalBaseX || 0;
            point.startY = point.originalBaseY || 0;
            const originalSize = point.layer === 'layer_1' ? baseEmojiSize : baseEmojiSize * layer2SizeMultiplier;
            point.startSize = originalSize;
            point.currentAlignedX = point.originalBaseX || 0;
            point.currentAlignedY = point.originalBaseY || 0;
            point.currentSize = originalSize;
            // Animation will be controlled by selection animation phase
            point.alignmentStartTime = now;
        } else if (animate && !isNewAlignment) {
            // RELAYOUT - start from current position for smooth transition
            point.startX = point.currentAlignedX;
            point.startY = point.currentAlignedY;
            point.startSize = point.currentSize;
            point.alignmentStartTime = now;
        } else {
            point.currentAlignedX = point.targetX;
            point.currentAlignedY = point.targetY;
            point.currentSize = point.targetSize;
            point.startX = point.targetX;
            point.startY = point.targetY;
            point.startSize = point.targetSize;
            point.alignmentStartTime = 0;
        }

        startX += imageWidth + horizontalGap;
    });

    // Calculate zoom levels
    // Zoom OUT: level that fits the ENTIRE grid centered in screen
    const screenPadding = 60;
    const availableWidth = canvas.width - screenPadding * 2;
    const zoomOutLevel = Math.min(availableWidth / totalWidthWithSideGaps, 1.0);
    
    // Zoom IN: final zoom level (fits row + side gaps in LEFT 2/3 region)
    const requiredZoom = regionWidth / totalWidthWithSideGaps;
    let bestIndex = 0;
    const maxAllowedIndex = initialZoomIndex;
    for (let i = Math.min(zoomLevels.length - 1, maxAllowedIndex); i >= 0; i--) {
        if (zoomLevels[i] <= requiredZoom) {
            bestIndex = i;
            break;
        }
    }
    const finalZoom = zoomLevels[bestIndex];
    
    // Pan for zoom out (centered)
    const zoomOutPanX = 0;
    
    // Pan for zoom in: focus on clicked image (from grid) or center-closest (from menu)
    let focusIndex;
    if (isNewAlignment) {
        if (selectionFocusPointForPhase2 && alignedEmojis.some(p => p === selectionFocusPointForPhase2 || (p.imagePath === selectionFocusPointForPhase2.imagePath && p.emojiIndex === selectionFocusPointForPhase2.emojiIndex))) {
            focusIndex = alignedEmojis.findIndex(p => p === selectionFocusPointForPhase2 || (p.imagePath === selectionFocusPointForPhase2.imagePath && p.emojiIndex === selectionFocusPointForPhase2.emojiIndex));
        } else {
            // From menu: pick image whose center is closest to screen center
            focusIndex = 0;
            let minDist = Infinity;
            alignedEmojis.forEach((p, idx) => {
                const d = Math.abs((p.targetX || 0) - centerX);
                if (d < minDist) { minDist = d; focusIndex = idx; }
            });
        }
        selectionFocusPointForPhase2 = null;
        selectionFocusIndexStored = focusIndex;
    } else {
        focusIndex = (selectionFocusIndexStored != null && selectionFocusIndexStored < alignedEmojis.length) ? selectionFocusIndexStored : 0;
    }
    const regionCenter = (regionLeft + regionRight) / 2;
    const focusTargetX = alignedEmojis[focusIndex] && (alignedEmojis[focusIndex].targetX != null) ? alignedEmojis[focusIndex].targetX : (worldLeftEdge + horizontalGap);
    const screenXAtPan0 = (focusTargetX - centerX) * finalZoom + centerX;
    const finalPanX = regionCenter - screenXAtPan0;

    if (isNewAlignment && animate) {
        // Start phased selection animation (reset fixed X so we capture it when phase 0)
        selectionAboutFixedLeftPx = null;
        selectionMoreFixedLeftPx = null;
        selectionAnimationHasRunForCurrentAlignment = true;
        selectionAnimationPhase = 1;
        selectionPhaseStartTime = now;
        selectionBasePanX = finalPanX; // For infinite carousel wrap
        
        // Store starting values
        selectionStartZoom = globalZoomLevel;
        selectionStartPanX = cameraPanX;
        selectionStartPanY = cameraPanY;
        
        // Store target values
        selectionTargetZoomOut = zoomOutLevel;
        selectionTargetZoomIn = finalZoom;
        selectionZoomOutPanX = zoomOutPanX;
        selectionFinalPanX = finalPanX;
        
        currentZoomIndex = bestIndex;
        
        // Fade out non-selected images (will animate during phase 1)
        points.forEach(p => {
            const isSelected = alignedEmojis.some(a => a.imagePath === p.imagePath || a.emojiIndex === p.emojiIndex);
            if (!isSelected) {
                p.targetOpacity = 0.0;
                p.isInactive = true;
            }
        });
    } else {
        // Relayout - adjust zoom and pan directly
    currentZoomIndex = bestIndex;
    startZoomTransition();
        targetCameraPanX = finalPanX;
        cameraPanX = finalPanX;
        selectionBasePanX = finalPanX;
    targetCameraPanY = 0;
    }
}

function scheduleAlignedMobileRelayoutIfNeeded(changedImagePath = null) {
    // Only matters for mobile vertical alignment layout
    if (alignedEmojiIndex === null) return;
    if (isFilterMode) return;
    if (!isMobileDevice()) return;
    if (!alignedEmojis || alignedEmojis.length === 0) return;

    if (changedImagePath) {
        const isInAlignedSet = alignedEmojis.some(p => p && p.imagePath === changedImagePath);
        if (!isInAlignedSet) return;
    }

    if (alignedRelayoutRaf) return;
    alignedRelayoutRaf = requestAnimationFrame(() => {
        alignedRelayoutRaf = 0;
        if (alignedEmojiIndex === null) return;
        if (!isMobileDevice()) return;
        layoutAlignedEmojisMobileVertical(true);
    });
}

/**
 * Lays out aligned emojis in a vertical column for mobile selection mode.
 * Images are aligned to the left edge (35px margin), have equal max dimensions,
 * and are limited to 65% of screen width. All images are scaled to the same
 * maximum dimension (width or height, whichever is larger).
 * 
 * @param {boolean} [animate=true] - Whether to animate the layout transition
 */
function layoutAlignedEmojisMobileVertical(animate = true) {
    if (alignedEmojiIndex === null) return;
    if (!isMobileDevice()) return;
    if (!alignedEmojis || alignedEmojis.length === 0) return;

    loadFullResForPaths(alignedEmojis.map(p => p.imagePath));
    loadHighresForPaths(alignedEmojis.map(p => p.imagePath));
    const selectedZoom = zoomLevels[initialZoomIndex]; // 1.0
    // Equal left and right margin (e.g. 14px or 4% each side), images use remaining width
    const marginScreen = Math.max(14, canvas.width * 0.04);
    const paddingScreen = marginScreen;
    const targetWidthScreen = canvas.width - 2 * marginScreen;
    const gapScreen = MOBILE_SELECTION_VERTICAL_GAP;
    const topPaddingScreen = marginScreen;

    const targetWidthWorld = targetWidthScreen / selectedZoom;
    const gapWorld = gapScreen / selectedZoom;
    const topPaddingWorld = topPaddingScreen / selectedZoom;
    const centerX = canvas.width / 2;

    const widths = [];
    const heights = [];
    // Mobile: no +25% (desktop keeps +25% in layoutAlignedEmojisDesktop)
    alignedEmojis.forEach(point => {
        const imageData = imageCache[point.imagePath];
        const ar = (imageData && imageData.aspectRatio) ? imageData.aspectRatio : 1;
        const widthWorld = targetWidthWorld;
        const heightWorld = widthWorld / (ar > 0 ? ar : 1);
        widths.push(widthWorld);
        heights.push(heightWorld);
    });

    // Measure about block (name + info) height for slot above first image
    let aboutBlockHeightWorld = 0;
    const aboutContainerEl = document.getElementById('projectAboutText');
    const aboutNameEl = document.getElementById('projectName');
    const aboutInfoEl = document.getElementById('projectInfo');
    const hasAbout = aboutContainerEl && ((aboutNameEl && aboutNameEl.textContent.trim().length > 0) || (aboutInfoEl && aboutInfoEl.textContent.trim().length > 0));
    mobileAboutBlockCenterYWorld = 0;
    mobileAboutBlockHeightWorld = 0;
    if (hasAbout) {
        const prevC = { position: aboutContainerEl.style.position, left: aboutContainerEl.style.left, width: aboutContainerEl.style.width, visibility: aboutContainerEl.style.visibility, display: aboutContainerEl.style.display, top: aboutContainerEl.style.top, transform: aboutContainerEl.style.transform };
        // Temporarily hide moreEl so it doesn't affect about block height measurement
        const moreElTemp = document.getElementById('projectMore');
        const prevMoreDisplay = moreElTemp ? moreElTemp.style.display : '';
        if (moreElTemp) moreElTemp.style.display = 'none';
        aboutContainerEl.style.position = 'fixed';
        aboutContainerEl.style.left = '-9999px';
        aboutContainerEl.style.width = targetWidthScreen + 'px';
        aboutContainerEl.style.visibility = 'hidden';
        aboutContainerEl.style.display = 'block';
        aboutContainerEl.style.top = '0';
        aboutContainerEl.style.transform = 'none';
        const hAbout = aboutContainerEl.offsetHeight;
        aboutContainerEl.style.position = prevC.position;
        aboutContainerEl.style.left = prevC.left;
        aboutContainerEl.style.width = prevC.width;
        aboutContainerEl.style.visibility = prevC.visibility;
        aboutContainerEl.style.display = prevC.display;
        aboutContainerEl.style.top = prevC.top;
        aboutContainerEl.style.transform = prevC.transform;
        if (moreElTemp) moreElTemp.style.display = prevMoreDisplay;
        aboutBlockHeightWorld = Math.max(48 / selectedZoom, (hAbout + 24) / selectedZoom); // +air so images don't overlap
        mobileAboutBlockMarginScreen = marginScreen;
        mobileAboutBlockWidthScreen = targetWidthScreen;
        mobileAboutBlockHeightWorld = aboutBlockHeightWorld;
    }

    // Measure more/extra block height for slot after first image (same gap as between images)
    let moreBlockHeightWorld = 0;
    const moreEl = document.getElementById('projectMore');
    const hasMore = moreEl && moreEl.textContent.trim().length > 0;
    mobileMoreBlockCenterYWorld = 0;
    mobileMoreBlockHeightWorld = 0;
    if (hasMore) {
        const prev = { position: moreEl.style.position, left: moreEl.style.left, width: moreEl.style.width, visibility: moreEl.style.visibility, display: moreEl.style.display };
        moreEl.style.position = 'fixed';
        moreEl.style.left = '-9999px';
        moreEl.style.width = targetWidthScreen + 'px';
        moreEl.style.visibility = 'hidden';
        moreEl.style.display = 'block';
        moreEl.style.fontSize = '14px';
        const h = moreEl.offsetHeight;
        moreEl.style.position = prev.position;
        moreEl.style.left = prev.left;
        moreEl.style.width = prev.width;
        moreEl.style.visibility = prev.visibility;
        moreEl.style.display = prev.display;
        moreBlockHeightWorld = Math.max(40 / selectedZoom, h / selectedZoom);
        mobileMoreBlockMarginScreen = marginScreen;
        mobileMoreBlockWidthScreen = targetWidthScreen;
        mobileMoreBlockHeightWorld = moreBlockHeightWorld;
    }

    let yTop = topPaddingWorld;
    // Reserve space for about block above first image; extra gap after about so images don't overlap text
    const aboutToImageGap = gapWorld * 1.8;
    if (hasAbout) {
        mobileAboutBlockCenterYWorld = yTop + aboutBlockHeightWorld / 2;
        yTop += aboutBlockHeightWorld + aboutToImageGap;
    }
    alignedEmojis.forEach((point, idx) => {
        if (idx === 1 && hasMore) {
            mobileMoreBlockCenterYWorld = yTop + moreBlockHeightWorld / 2;
            yTop += moreBlockHeightWorld + gapWorld;
        }
        const widthWorld = widths[idx];
        const heightWorld = heights[idx];
        const centerYWorld = yTop + (heightWorld / 2);

        point.isAligned = true;
        point.isInactive = true;
        point.targetWidth = widthWorld;
        point.targetHeight = heightWorld;
        point.targetSize = Math.max(widthWorld, heightWorld);
        point.targetOpacity = 1.0;
        
        const screenX = paddingScreen + (targetWidthScreen / 2);
        point.targetX = ((screenX - centerX) / selectedZoom) + centerX;
        point.targetY = centerYWorld;

        if (animate) {
            point.startX = point.currentAlignedX || point.originalBaseX || 0;
            point.startY = point.currentAlignedY || point.originalBaseY || 0;
            point.startSize = point.currentSize || point.targetSize;
            point.alignmentStartTime = performance.now();
        } else {
            point.currentAlignedX = point.targetX;
            point.currentAlignedY = point.targetY;
            point.currentSize = point.targetSize;
            point.startX = point.targetX;
            point.startY = point.targetY;
            point.startSize = point.targetSize;
            point.alignmentStartTime = 0;
        }

        yTop += heightWorld + gapWorld;
    });

    mobileAlignedContentHeightWorld = yTop + topPaddingWorld;
    const firstCenterYWorld = alignedEmojis[0].targetY;
    const worldOffsetY = (firstCenterYWorld - (canvas.height / 2)) * selectedZoom;
    mobileAlignedBasePanY = -worldOffsetY;
    mobileAlignedBasePanX = 0;

    mobileScrollPosition = 0;
    targetMobileScrollPosition = 0;
    mobileScrollVelocity = 0;

    currentZoomIndex = initialZoomIndex;
    globalZoomLevel = selectedZoom;
    targetZoomLevel = selectedZoom;
    isZoomTransitioning = false;
    targetCameraPanX = 0;
    targetCameraPanY = mobileAlignedBasePanY;
    cameraPanX = 0;
    cameraPanY = mobileAlignedBasePanY;

    scrollIndicatorVisible = (mobileAlignedContentHeightWorld * selectedZoom) > canvas.height;
    if (scrollIndicatorVisible) {
        scrollIndicatorFadeTime = performance.now() + 3000;
    }
}

// Filter state
let currentFilterTag = null; // null = no filter, otherwise the tag to filter by
let filteredImages = []; // Array of filtered image points
let isFilterMode = false; // Whether we're in filter mode
let isWeAreMode = false; // Whether we're in "We are" mode

// Index mode state (hashtag-based folder navigation)
let isIndexMode = false; // Whether we're in index mode (showing folder list)
let indexModeFolders = []; // Array of folder names matching current hashtag
let selectedIndexFolder = null; // Currently selected folder in index mode
let indexModeTag = null; // Current hashtag being filtered

// Hashtag to category mapping
const HASHTAG_MAP = {
    'stage': '#stage',
    'install': '#installation',
    'concept': '#concept',
    'tech': '#tech',
    'spatial': '#spatial'
};

// Folder name to tags mapping (since imagePaths don't include hashtags)
// Maps clean folder names to their hashtag categories
const FOLDER_TAGS = {
    '2gis': ['spatial'],
    'Addon 26': ['installation'],
    'belgium institution ? ': ['spatial', 'installation'],
    'bipolar express': ['stage', 'tech'],
    'Bluebeard_s Castle': ['stage', 'installation'],
    'Concepts': ['spatial', 'concept'],
    'fixtures decoratif': ['concept'],
    'gate': ['installation'],
    'gula merah': ['stage'],
    'Justice': ['stage'],
    'Kedrina': ['stage'],
    'la fleurs': ['spatial'],
    'mirag club': ['stage'],
    'Mirage Cinema': ['spatial'],
    'missoni': ['spatial', 'concept'],
    'New star camp': ['stage'],
    'Nina kravitz': ['stage'],
    'port': ['stage'],
    'Potato head bali': ['stage'],
    'signal': ['spatial', 'installation'],
    'Spatial design koridor': ['spatial', 'stage'],
    'Telegraph': ['spatial'],
    'thresholds': ['installation'],
    'torus': ['spatial', 'installation'],
    'tower building': ['spatial', 'installation'],
    'wish circles': ['spatial', 'installation'],
    'yndx interactive zone': ['spatial', 'installation']
};

// Helper: extract tags from folder name when hashtags are embedded in the folder itself
function deriveTagsFromFolderName(folderNameRaw) {
    const name = (folderNameRaw || '').toLowerCase();
    const tags = [];
    if (name.includes('#stage')) tags.push('stage');
    if (name.includes('#installation') || name.includes('#instalation') || name.includes('#instal')) tags.push('installation');
    if (name.includes('#concept')) tags.push('concept');
    if (name.includes('#tech')) tags.push('tech');
    if (name.includes('#spatial')) tags.push('spatial');
    return tags;
}

// Helper: map folder name (with or without hashtags) to tag list
function getFolderTags(folderNameRaw) {
    const folderName = (folderNameRaw || '').trim();
    const hashtagTags = deriveTagsFromFolderName(folderName);
    if (hashtagTags.length > 0) {
        return hashtagTags;
    }
    // Fallback to manual mapping using clean names (without hashtag suffixes)
    const strippedName = folderName.replace(/\s+#.*$/, '').trim();
    return FOLDER_TAGS[folderName] || FOLDER_TAGS[strippedName] || [];
}

// Zoom focal point (for mouse-relative zoom)
// Initialize to center of screen to avoid zoom from (0,0) on first zoom
let zoomFocalPointX = null; // Screen X coordinate of zoom focal point (null = use current mouse position)
let zoomFocalPointY = null; // Screen Y coordinate of zoom focal point (null = use current mouse position)

// Mobile vertical scroll state
let mobileScrollPosition = 0; // Current scroll position (0 = top, 1 = bottom)
let targetMobileScrollPosition = 0; // Target scroll position
let isMobileScrolling = false; // Whether user is currently scrolling
let scrollIndicatorVisible = false; // Whether scroll indicator is visible
let scrollIndicatorFadeTime = 0; // Time when scroll indicator should fade
let mobileScrollVelocity = 0; // Inertia velocity for aligned mobile scroll (position units per ms)
let mobileAlignedBasePanY = 0; // Base pan offset (screen px) for scroll position 0
let mobileAlignedContentHeightWorld = 0; // Total content height in world units (images + gaps + padding)
let mobileAlignedBasePanX = 0; // Base pan offset X (screen px) for left-aligned selection column
let mobileMoreBlockCenterYWorld = 0; // Center Y of more.txt block in world (0 = no block)
let mobileMoreBlockHeightWorld = 0;
let mobileMoreBlockMarginScreen = 0;
let mobileMoreBlockWidthScreen = 0;
let mobileAboutBlockCenterYWorld = 0; // Center Y of about block in world (0 = no block)
let mobileAboutBlockHeightWorld = 0;
let mobileAboutBlockMarginScreen = 0;
let mobileAboutBlockWidthScreen = 0;

// Touch interaction state (iPhone/iPad)
let lastTouchX = 0;
let lastTouchY = 0;
let lastTouchTime = 0;
let isPinching = false;
let pinchStartDistance = 0;
let pinchStartZoom = 1.0;
let useContinuousZoom = false; // Enable smooth, continuous zoom on touch devices

// Gyroscope/orientation state for mobile parallax
let deviceOrientationSupported = false;
let initialBeta = null; // Initial tilt forward/backward (calibration)
let initialGamma = null; // Initial tilt left/right (calibration)
let currentBeta = 0; // Current tilt forward/backward
let currentGamma = 0; // Current tilt left/right
let smoothGyroX = 0; // Smoothed gyroscope X offset (from gamma)
let smoothGyroY = 0; // Smoothed gyroscope Y offset (from beta)
const gyroSmoothness = 0.15; // Smoothness factor for gyroscope data (lower = smoother)
const gyroParallaxStrength = 0.25; // Strength of gyroscope parallax effect (increased for better responsiveness)

function getTouchDistance(t1, t2) {
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getTouchMidpoint(t1, t2) {
    return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2
    };
}

// Image list — paths relative to Artsy/ (see scripts/generate-image-list.js)
const imagePaths = [
    'Acousmonium /Screenshot 2024-07-27 at 15.43.45.png',
    'Acousmonium /pasted-image.png',
    'Acousmonium /photo_2562@19-07-2021_12-45-07.jpg',
    'Addon 26 #instal/IMG_3654.png',
    'Addon 26 #instal/IMG_3659.png',
    'Addon 26 #instal/Screenshot 2026-01-03 at 15.53.45.png',
    'Addon 26 #instal/Screenshot 2026-01-03 at 15.54.20.png',
    'Addon 26 #instal/TDMovieOut.0.png',
    'Addon 26 #instal/TDMovieOut.10.png',
    'Addon 26 #instal/TDMovieOut.2.png',
    'Addon 26 #instal/addon26.png',
    'Addon 26 #instal/ind_Screenshot 2026-01-03 at 15.53.30.png',
    'Addon 26 #instal/ind_addon pc.png',
    'Addon 26 #instal/photo_2021-04-06_03-24-48.jpg',
    'Addon 26 #instal/poster.jpg',
    'Beggar/Screenshot 2023-07-18 at 17.48.01.png',
    'Beggar/haram1.png',
    'Broken Karaoke/bkk2.jpg',
    'Broken Karaoke/photo_2024-05-23_11-55-31.jpg',
    'Broken Karaoke/photo_2024-07-02_01-50-58.jpg',
    'Broken Karaoke/photo_2024-07-31_22-06-45.jpg',
    'Broken Karaoke/photo_2024-08-13_16-43-04.jpg',
    'CCC/Instagram story - 1@2x.png',
    'CCC/Screenshot 2025-12-13 at 16.26.19.png',
    'CCC/Screenshot 2025-12-13 at 16.26.46.png',
    'CCC/Screenshot 2025-12-13 at 16.50.34.png',
    'CCC/awarness.png',
    'CCC/photo_2024-07-12_06-09-30.jpg',
    'Chertochki /Screenshot 2025-03-13 at 23.22.55.png',
    'Chertochki /Screenshot 2025-03-14 at 01.46.33.png',
    'Chertochki /Screenshot 2026-04-07 at 16.18.40.png',
    'Chertochki /chertochki .jpg',
    'Chertochki /photo_2024-05-02_01-23-25.jpg',
    'Chertochki /photo_2024-05-11_21-43-51.jpg',
    'Chertochki /photo_2024-05-20_21-16-49.jpg',
    'Chertochki /photo_2025-03-19_21-49-03.jpg',
    'Chertochki /photo_2025-03-20_17-25-43.png',
    'Cicada simulation /Murmur of many voices.png',
    'Cicada simulation /cicada-nine.png',
    'Cicada simulation /png-transparent-cicada.png',
    'Circular Repetition   #instal/CR.png',
    'Circular Repetition   #instal/ComfyUI_00006_bw.png',
    'Circular Repetition   #instal/Screenshot 2026-03-06 at 13.46.40.png',
    'Circular Repetition   #instal/la bienalle.png',
    'Definition /Screenshot 2023-07-18 at 17.56.35.png',
    'Definition /Screenshot 2026-04-07 at 15.43.17.png',
    'Definition /Screenshot 2026-04-07 at 15.43.25.png',
    'Definition /Screenshot 2026-04-07 at 15.43.35.png',
    'Definition /Screenshot 2026-04-07 at 15.43.42.png',
    'Definition /Screenshot 2026-04-07 at 15.43.57.png',
    'Definition /Screenshot 2026-04-07 at 18.53.45.png',
    'Empreian Tiflis/Screen Shot 2018-10-25 at 15.09.43.png',
    'Empreian Tiflis/Screen Shot 2018-10-25 at 15.12.25.png',
    'Empreian Tiflis/tiflis.webp',
    'Flora/Screenshot 2026-04-07 at 17.17.55.png',
    'Flora/photo_2021-07-25_01-23-59.jpg',
    'Marche Nocturn /Screenshot 2023-07-11 at 23.47.11.png',
    'Marche Nocturn /Screenshot 2023-07-11 at 23.48.52.png',
    'Marche Nocturn /Screenshot 2023-07-12 at 00.26.54.png',
    'Marche Nocturn /Screenshot 2023-07-18 at 17.05.47.png',
    'Marche Nocturn /Screenshot 2025-03-10 at 16.54.40.png',
    'Marche Nocturn /Screenshot 2025-03-10 at 16.54.51.png',
    'Marche Nocturn /mach nocturne .001.png',
    'Marche Nocturn /marche/Screenshot 2023-07-11 at 23.28.47_result.png',
    'Marche Nocturn /marche/Screenshot 2023-07-11 at 23.31.49_result.png',
    'Marche Nocturn /marche/Screenshot 2023-07-11 at 23.47.11_result.png',
    'Marche Nocturn /marche/Screenshot 2023-07-11 at 23.48.52_result.png',
    'Marche Nocturn /marche/Screenshot 2023-07-12 at 00.26.54_result.png',
    'Marche Nocturn /marche/Screenshot 2023-07-18 at 15.01.41_result.png',
    'Marche Nocturn /marche/bourges_donout2_result.png',
    'Marche Nocturn /marche/bourges_donout_result.png',
    'Marche Nocturn /marche/bourges_walk0.png',
    'Marche Nocturn /marche/bourges_walk0_result.png',
    'Marche Nocturn /marche/bourges_walk1.png',
    'Marche Nocturn /marche/bourges_walk101_result.png',
    'Marche Nocturn /marche/bourges_walk102_result.png',
    'Marche Nocturn /marche/bourges_walk103_result.png',
    'Marche Nocturn /marche/bourges_walk104_result.png',
    'Marche Nocturn /marche/bourges_walk105_result.png',
    'Marche Nocturn /marche/bourges_walk106_result.png',
    'Marche Nocturn /marche/bourges_walk107_result.png',
    'Marche Nocturn /marche/bourges_walk1_result.png',
    'Marche Nocturn /marche/bourges_walk2.png',
    'Marche Nocturn /marche/bourges_walk29.png',
    'Marche Nocturn /marche/bourges_walk2_result.png',
    'Marche Nocturn /marche/bourges_walk4_result.png',
    'Marche Nocturn /marche/bourges_walk66_result.png',
    'Marche Nocturn /marche/bourges_walk70_result.png',
    'Marche Nocturn /marche/bourges_walk71_result.png',
    'Marche Nocturn /marche/bourges_walk81_result.png',
    'Marche Nocturn /marche/ensa bourges.png',
    'Middle east/IMG_8410_10mb.gif',
    'Middle east/IMG_8433_10mb.gif',
    'Middle east/IMG_8434_10mb.gif',
    'Middle east/IMG_8576_10mb.gif',
    'Middle east/IMG_8708_10mb.gif',
    'Middle east/IMG_8720_10mb.gif',
    'Nat.sim /ComfyUI_00062_.png',
    'Nat.sim /IMG_4385.jpeg',
    'Nat.sim /Screenshot 2025-04-13 at 20.39.59.png',
    'Nat.sim /Spat5Move.gif',
    'Nat.sim /nat.sim.gif',
    'Nat.sim /photo_2025-04-13_20-02-40.jpg',
    'Psyche/IMG_2ACD02C483E1-1.jpeg',
    'Psyche/IMG_A3BD3A5D911A-1.jpeg',
    'Psyche/Screenshot 2024-07-27 at 15.56.50.png',
    'Psyche/pasted-image.png',
    'Shapes/photo_2022-09-09_18-36-57.jpg',
    'Shapes/photo_2022-09-10_11-32-25.jpg',
    'Shapes/photo_2022-09-10_11-32-26.jpg',
    'Shapes/photo_2022-09-11_20-12-15.jpg',
    'Shapes/photo_2022-09-11_20-12-19.jpg',
    'Shapes/photo_2022-09-11_21-38-30.jpg',
    'Shapes/photo_2022-09-11_21-38-31.jpg',
    'Shapes/photo_2022-09-11_22-07-05.jpg',
    'Spectral shapes/B/Screenshot 2023-06-11 at 21.41.40_result.png',
    'Spectral shapes/B/Screenshot 2023-06-12 at 01.42.41_result.png',
    'Spectral shapes/B/Screenshot 2023-06-12 at 02.25.59_result.png',
    'Spectral shapes/B/Screenshot 2023-06-12 at 02.30.07_result.png',
    'Spectral shapes/B/Screenshot 2023-07-11 at 22.19.57_result.png',
    'Spectral shapes/B/Screenshot 2023-07-11 at 22.20.09_result.png',
    'Spectral shapes/B/Screenshot 2023-07-25 at 23.14.46_result.png',
    'Spectral shapes/B/Screenshot 2023-08-12 at 16.34.24_result.png',
    'Spectral shapes/B/Screenshot 2023-08-21 at 01.08.40_result.png',
    'Spectral shapes/B/Screenshot 2023-09-01 at 21.40.19_result.png',
    'Spectral shapes/IMG_9007.jpeg',
    'Spectral shapes/IMG_9142.jpeg',
    'Spectral shapes/Screenshot 2021-12-01 at 22.03.57.png',
    'Spectral shapes/Screenshot 2023-07-27 at 11.40.10.png',
    'Spectral shapes/click4.png',
    'Spectral shapes/click6.png',
    'Spectral shapes/hi_size.png',
    'Spectral shapes/long_one.png',
    'Spectral shapes/warped IRs.png',
    'Spectral veawings/carpets/carpet15_result.png',
    'Spectral veawings/carpets/carpet16_result.png',
    'Spectral veawings/carpets/carpet17_result.png',
    'Spectral veawings/carpets/carpet19_result.png',
    'Spectral veawings/carpets/carpet20_result.png',
    'Spectral veawings/carpets/carpet21_result.png',
    'Spectral veawings/carpets/carpet22_result.png',
    'Spectral veawings/carpets/carpet23.png',
    'Spectral veawings/carpets/carpet23_result.png',
    'Spectral veawings/carpets/carpet24_result.png',
    'Spectral veawings/carpets/carpet25_result.png',
    'Spectral veawings/carpets/carpet26.png',
    'Spectral veawings/carpets/carpet26_result.png',
    'Spectral veawings/carpets/carpet27.png',
    'Spectral veawings/carpets/carpet27_result.png',
    'Spectral veawings/carpets/carpet28.png',
    'Spectral veawings/carpets/carpet28_result.png',
    'Spectral veawings/carpets/carpet29.png',
    'Spectral veawings/carpets/carpet29_result.png',
    'Thresholds/Screenshot 2024-11-24 at 22.18.45.png',
    'Thresholds/Screenshot 2024-11-24 at 22.21.12.png',
    'Thresholds/liminal8.png',
    'Thresholds/pasted-image.png',
    'Thresholds/textured_3_1kMhVqro.jpg',
    'Thresholds/textured_4_1kMhVqro.jpg',
    'Thresholds/textured_5_1kMhVqro.jpg',
    'Thresholds/textured_9_1kMhVqro.jpg',
    'Your eyes /photo_2019-07-25_15-19-42.jpg',
    'Your eyes /photo_2019-07-25_15-40-52.jpg',
    'Zatmenie 1/Screen Shot 2019-01-07 at 00.25.33.png',
    'Zatmenie 1/pasted-image-2.png',
    'Zatmenie 1/photo_2647@05-08-2021_23-09-08.jpg',
    'Zatmenie 1/prev-2.jpg',
    'Zatmenie 1/zatmenie.001.png',
    'Zatmenie 2/Screenshot 2025-03-10 at 17.13.41.png',
    'Zatmenie 2/Screenshot 2025-03-10 at 17.14.00.png',
    'Zatmenie 2/pasted-image-filtered.jpeg',
    'ex_m6/A/20240314_180920_resized.jpg',
    'ex_m6/A/Photo027.jpg',
    'ex_m6/IMG_1365.jpeg',
    'ex_m6/IMG_1388.jpeg',
    'ex_m6/Screenshot 2024-02-27 at 23.59.20.png',
    'ex_m6/exm_book_comp_part1.gif',
    'ex_m6/exm_book_comp_part2.gif',
    'ex_m6/pasted-image-3.png',
    'ex_m6/photo_2024-03-03_21-39-45.jpg',
    'extractive memories/Screenshot 2024-10-13 at 03.18.05.png',
    'iced/gula vis.jpg',
    'iced/iced.jpg',
    'iced/iced3.jpg',
    'iced/iced5.jpg',
    'sculpture/Screenshot 2022-02-16 at 13.16.32.png'
];

// Image cache: thumb = grid (small), img = full-res (selection mode). Draw uses img || thumb.
const imageCache = {};
let imagesLoaded = 0;
let totalImages = 0;
let imagesLoadedSuccessfully = 0;
const imageLoadPromises = new Map();

// Loading text variables
let allWordsVisible = false;
let visibleWordsCount = 0;
let totalWords = 0;

// Initialize loading text animation
function initLoadingText() {
    const loadingTextEl = document.getElementById('loadingText');
    if (!loadingTextEl) {
        console.error('loadingText element not found!');
        // Fallback: if loading text is missing, allow images to show
        allWordsVisible = true;
        checkIfReadyToShowImages();
        return;
    }
    
    const text = "Welcome to Spatial Playground";
    // Split by space - ВАЖНО: не фильтруем, просто разбиваем
    const words = text.split(' ');
    // Убираем пустые строки ТОЛЬКО после split
    const filteredWords = words.filter(w => w.length > 0);
    totalWords = filteredWords.length;
    visibleWordsCount = 0;
    allWordsVisible = false;
    debugLog('Initializing loading text:', text, { totalWords, filteredWords, words });
    
    // Clear and prepare container
    loadingTextEl.innerHTML = '';
    
    // Create word elements - КАЖДОЕ слово отдельно, ВКЛЮЧАЯ "Spatial"
    filteredWords.forEach((word, index) => {
        const wordSpan = document.createElement('span');
        wordSpan.className = 'word';
        wordSpan.textContent = word;
        // НЕ устанавливаем inline opacity - используем только CSS
        loadingTextEl.appendChild(wordSpan);
        
        debugLog(`Created word ${index + 1}/${totalWords}: "${word}"`);
        
        // Animate word appearance with 0.6s delay per word
        setTimeout(() => {
            // Добавляем класс visible - CSS transition сработает
            wordSpan.classList.add('visible');
            visibleWordsCount++;
            debugLog(`Word ${index + 1}/${totalWords} "${word}" visible (${visibleWordsCount}/${totalWords})`);
            
            // Check if all words are now visible
            if (visibleWordsCount >= totalWords) {
                // Даем время для CSS transition (0.6s)
                setTimeout(() => {
                    allWordsVisible = true;
                    debugLog('All words are now visible!', { totalWords, visibleWordsCount, allWords: filteredWords });
                    checkIfReadyToShowImages();
                }, 650); // Немного больше чем transition duration
            }
        }, index * 600); // 0.6 seconds per word
    });
    
    // Safety: ensure words become "visible" after a timeout to avoid blocking the grid
    setTimeout(() => {
        if (!allWordsVisible) {
            allWordsVisible = true;
            checkIfReadyToShowImages();
        }
    }, MAX_LOADING_SCREEN_WAIT_MS);
}


// Global flag to track if all images are loaded
let allImagesLoaded = false;
let allImagesLoadedTime = null; // Time when all images finished loading
const SELECTION_MODE_COOLDOWN = 2000; // 2 seconds cooldown after all images loaded
const CONNECTION_MODE_COOLDOWN = 2000; // 2 seconds cooldown after loading screen - no dotted line animation

// Update loading progress bar (Mac-style bar under "Welcome to Spatial Playground")
// Only script sets width; React must NOT set width on the fill or it overwrites this on re-render
function updateLoadingProgressBar() {
    var fillEl = document.getElementById('loadingProgressBarFill');
    if (!fillEl) return;
    if (totalImages === 0) {
        fillEl.style.setProperty('width', '100%');
        return;
    }
    var pct = Math.min(100, Math.round((imagesLoaded / totalImages) * 100));
    fillEl.style.setProperty('width', pct + '%');
}

// Check if ready to show images (both words and images must be ready)
function checkIfReadyToShowImages() {
    updateLoadingProgressBar();
    // Keep "Welcome to Spatial Playground" visible until ALL images are loaded
    // Only hide when all words are visible AND all images have finished loading (success or error)
    // If no images (totalImages === 0), treat as loaded so mobile doesn't stay on white/loading
    allImagesLoaded = totalImages === 0 || (imagesLoaded >= totalImages && totalImages > 0);
    
    // Debug logging for mobile troubleshooting
    if (window.innerWidth < 768 || ('ontouchstart' in window)) {
        debugLog(`Mobile checkIfReadyToShowImages: allWordsVisible=${allWordsVisible}, imagesLoaded=${imagesLoaded}/${totalImages}, allImagesLoaded=${allImagesLoaded}`);
    }
    
    if (allWordsVisible && allImagesLoaded) {
        // Record time when all images finished loading
        if (allImagesLoadedTime === null) {
            allImagesLoadedTime = performance.now();
        }
        hideLoadingIndicator();
        // Set initial load time for mobile click prevention
        if (isMobileDevice()) {
            mobileInitialLoadTime = performance.now();
        }
    }
}

// Normalize folder key for connection trajectories (same key in precompute and hover)
function getPointFolder(point) {
    let folder = point.folderPath || point.imagePath.substring(0, point.imagePath.lastIndexOf('/'));
    if (folder === point.imagePath || folder === '') {
        folder = 'final images';
    }
    return folder;
}

// Pre-compute connection trajectories for all folders
function precomputeConnectionTrajectories() {
    precomputedConnectionTrajectories.clear();
    
    const folderGroups = new Map();
    points.forEach(point => {
        const folder = getPointFolder(point);
        if (!folderGroups.has(folder)) {
            folderGroups.set(folder, []);
        }
        folderGroups.get(folder).push(point);
    });
    
    // Pre-compute trajectories for each folder (sort by X position)
    folderGroups.forEach((folderPoints, folder) => {
        if (folderPoints.length > 1) {
            // Sort by X position (left to right)
            const sorted = [...folderPoints].sort((a, b) => {
                return a.originalBaseX - b.originalBaseX;
            });
            precomputedConnectionTrajectories.set(folder, {
                points: sorted,
                sorted: true
            });
        }
    });
    
    console.log(`Pre-computed connection trajectories for ${precomputedConnectionTrajectories.size} folders`);
}

// Hide loading indicator and show canvas
let loadingComplete = false;
function hideLoadingIndicator() {
    if (loadingComplete) return;
    loadingComplete = true;
    
    // Pre-compute connection trajectories during loading screen
    precomputeConnectionTrajectories();
    
    const loadingIndicator = document.getElementById('loadingIndicator');
    if (loadingIndicator) {
        loadingIndicator.classList.add('hidden');
        setTimeout(() => {
            if (loadingIndicator.parentNode) {
                loadingIndicator.parentNode.removeChild(loadingIndicator);
            }
        }, 1000);
    }
    
    if (canvas) {
        canvas.classList.add('images-loaded');
    }
}

// Load all images with better error handling
function loadImages() {
    // Start loading text animation FIRST
    initLoadingText();

    const uniquePaths = [...new Set(imagePaths)];
    totalImages = uniquePaths.length;
    imagesLoaded = 0;
    imagesLoadedSuccessfully = 0;
    updateLoadingProgressBar();
    
    if (uniquePaths.length === 0) {
        console.warn('No image paths to load.');
        checkIfReadyToShowImages();
        return;
    }
    
    debugLog(`Attempting to load ${uniquePaths.length} images...`);

    const eagerPaths = uniquePaths.slice(0, INITIAL_IMAGES_TO_LOAD);
    const deferredPaths = uniquePaths.slice(INITIAL_IMAGES_TO_LOAD);

    // Eager: start quickly to get first pixels (progress bar updates via checkIfReadyToShowImages in each .finally)
    loadImagesWithConcurrency(eagerPaths);

    // Deferred: avoid competing with main-thread startup work.
    const startDeferred = () => loadImagesWithConcurrency(deferredPaths);
    const isMobile = window.innerWidth < 768 || ('ontouchstart' in window);
    if (!isMobile && typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(startDeferred, { timeout: 2000 });
    } else {
        setTimeout(startDeferred, 100);
    }

    // Home screen only after ALL image load attempts have settled (success or error)
    Promise.allSettled(uniquePaths.map(p => loadImageWithRetry(p, 3))).then(() => {
        checkIfReadyToShowImages();
    });
    
    // Safety timeout: if loading hangs, force completion to reveal the canvas
    setTimeout(() => {
        if (!loadingComplete) {
            console.warn('Loading timed out — forcing grid display');
            allWordsVisible = true;
            allImagesLoaded = true;
            hideLoadingIndicator();
        }
    }, MAX_LOADING_SCREEN_WAIT_MS);
}

// createImageBitmap captures only the first frame of GIFs; keep HTMLImageElement so the draw loop can animate them.
function shouldKeepHtmlImageForCanvas(path) {
    if (!path || typeof path !== 'string') return false;
    return /\.gif$/i.test(path);
}

// Most browsers only advance animated GIF frames for <img> elements that are attached to the document.
// drawImage() from a detached Image/bitmap typically shows a frozen first frame.
function ensureCanvasGifPlaybackHost() {
    if (typeof document === 'undefined') return null;
    var el = document.getElementById('__canvasGifPlaybackHost');
    if (!el) {
        el = document.createElement('div');
        el.id = '__canvasGifPlaybackHost';
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText = 'position:fixed;left:-9999px;top:0;width:8px;height:8px;overflow:hidden;opacity:0.02;pointer-events:none;z-index:0';
        (document.body || document.documentElement).appendChild(el);
    }
    return el;
}

function pinHtmlImageForGifPlayback(img) {
    if (!img || img.nodeName !== 'IMG') return;
    var host = ensureCanvasGifPlaybackHost();
    if (!host) return;
    if (img.parentElement === host) return;
    host.appendChild(img);
}

function loadImagesWithConcurrency(paths) {
    if (!paths || paths.length === 0) return Promise.resolve();

    let nextIndex = 0;
    const workerCount = Math.min(IMAGE_LOAD_CONCURRENCY, paths.length);

    const workers = Array.from({ length: workerCount }, async () => {
        while (nextIndex < paths.length) {
            const path = paths[nextIndex++];
            await loadImageWithRetry(path, 3);
        }
    });

    return Promise.all(workers).then(() => undefined);
}

function loadImageWithRetry(path, retries, useThumb) {
    if (useThumb === undefined) useThumb = true;
    const key = path + (useThumb ? ':thumb' : ':full');
    if (imageLoadPromises.has(key)) return imageLoadPromises.get(key);

    const promise = (async () => {
        const skipProgress = !useThumb; // don't affect loading bar when loading full-res for selection
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const imageData = await loadImageOnce(path, useThumb, skipProgress);
                if (imageData) return imageData;
            } catch (e) {
                if (attempt < retries) {
                    await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
                }
            }
        }
        return null;
    })().finally(() => {
        if (useThumb) checkIfReadyToShowImages();
    });

    imageLoadPromises.set(key, promise);
    return promise;
}

// Load full-res for selection mode (does not affect loading screen progress)
function loadFullResForPaths(paths) {
    if (!paths || paths.length === 0) return;
    paths.forEach(p => {
        const cached = imageCache[p];
        if (cached && cached.img) return; // already have full-res
        loadImageWithRetry(p, 2, false);
    });
}

// Path to highres version: "final images/folder/file.jpg" -> "final images/folder/highres/file.jpg"
function getHighresPath(path) {
    if (!path || path.indexOf('/') < 0) return null;
    const lastSlash = path.lastIndexOf('/');
    const folder = path.substring(0, lastSlash);
    const filename = path.substring(lastSlash + 1);
    return folder + '/highres/' + filename;
}

// Load highres from folder/highres/ and upgrade cache when ready (smooth, non-blocking)
function loadHighresOnce(originalPath) {
    const highresPath = getHighresPath(originalPath);
    if (!highresPath) return Promise.resolve();
    const url = getImageUrl(highresPath, false);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = async () => {
            try {
                var isGifHigh = shouldKeepHtmlImageForCanvas(highresPath) || shouldKeepHtmlImageForCanvas(originalPath);
                if (typeof img.decode === 'function' && !isGifHigh) {
                    try { await img.decode(); } catch (_) {}
                }
                let drawable = img;
                const isMobile = typeof window !== 'undefined' && (window.innerWidth < 768 || ('ontouchstart' in window));
                if (!isMobile && typeof createImageBitmap === 'function' && !shouldKeepHtmlImageForCanvas(highresPath)) {
                    try {
                        drawable = await createImageBitmap(img, { imageOrientation: 'from-image' });
                    } catch (_) {}
                }
                const entry = imageCache[originalPath];
                if (entry) {
                    entry.img = drawable;
                    entry.width = drawable.width || img.naturalWidth;
                    entry.height = drawable.height || img.naturalHeight;
                    entry.aspectRatio = (entry.width && entry.height) ? entry.width / entry.height : entry.aspectRatio;
                    if (isGifHigh && drawable && drawable.nodeName === 'IMG') pinHtmlImageForGifPlayback(drawable);
                    scheduleAlignedDesktopRelayoutIfNeeded(originalPath);
                    scheduleAlignedMobileRelayoutIfNeeded(originalPath);
                }
            } catch (_) {}
            resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
    });
}

// Load highres for selection mode after full-res is shown (staggered, non-blocking)
function loadHighresForPaths(paths) {
    if (!paths || paths.length === 0) return;
    const HIGHRES_STAGGER_MS = 80;
    paths.forEach((p, index) => {
        setTimeout(() => loadHighresOnce(p), index * HIGHRES_STAGGER_MS);
    });
}

function getImageUrl(path, useThumb) {
    if (typeof window !== 'undefined' && (window.__IMAGE_BASE__ === undefined || window.__IMAGE_BASE__ === '')) {
        ensureImageBase();
        if (window.__IMAGE_BASE__ === undefined || window.__IMAGE_BASE__ === '') window.__IMAGE_BASE__ = '/img';
    }
    const subPath = (typeof window !== 'undefined' && window.__IMAGE_BASE__)
      ? path.replace(/^final images\/+/, '')
      : path;
    const pathForUrl = useThumb ? ('thumb/' + subPath) : subPath;
    const encoded = pathForUrl.split('/').map(part => encodeURIComponent(part)).join('/');
    const base = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
    const prefix = (typeof window !== 'undefined' && window.__IMAGE_BASE__) ? String(window.__IMAGE_BASE__).replace(/\/+$/, '') : '';
    const sep = prefix && !prefix.startsWith('/') ? '/' : '';
    return base + (prefix ? sep + prefix + '/' : '/') + encoded;
}

function loadImageOnce(path, useThumb, skipProgress) {
    if (useThumb === undefined) useThumb = true;
    if (skipProgress === undefined) skipProgress = false;

    return new Promise((resolve, reject) => {
        const cached = imageCache[path];
        if (useThumb && cached && (cached.thumb || cached.img)) {
            if (!skipProgress) { imagesLoaded++; updateLoadingProgressBar(); }
            resolve(cached);
            return;
        }
        if (!useThumb && cached && cached.img) {
            resolve(cached);
            return;
        }

        const img = new Image();
        img.decoding = 'async';

        img.onload = async () => {
            try {
                var isGifPath = shouldKeepHtmlImageForCanvas(path);
                if (typeof img.decode === 'function' && !isGifPath) {
                    try { await img.decode(); } catch {}
                }
                var drawable = img;
                var width = img.naturalWidth;
                var height = img.naturalHeight;
                var isMobile = typeof window !== 'undefined' && (window.innerWidth < 768 || ('ontouchstart' in window));
                if (!isMobile && typeof createImageBitmap === 'function' && !isGifPath) {
                    try {
                        var bitmap = await createImageBitmap(img, { imageOrientation: 'from-image' });
                        drawable = bitmap;
                        width = bitmap.width;
                        height = bitmap.height;
                    } catch {}
                }

                if (!imageCache[path]) {
                    imageCache[path] = { thumb: null, img: null, width: 0, height: 0, aspectRatio: 1, error: false };
                }
                const entry = imageCache[path];
                if (useThumb) {
                    entry.thumb = drawable;
                    entry.width = width;
                    entry.height = height;
                    entry.aspectRatio = width / height;
                } else {
                    entry.img = drawable;
                    entry.width = width;
                    entry.height = height;
                    entry.aspectRatio = width / height;
                }
                entry.error = false;
                if (isGifPath && drawable && drawable.nodeName === 'IMG') pinHtmlImageForGifPlayback(drawable);

                if (!skipProgress) {
            imagesLoaded++;
            imagesLoadedSuccessfully++;
                    updateLoadingProgressBar();
                    debugLog('Loaded ' + (useThumb ? 'thumb' : 'full') + ' ' + path);
                }
            scheduleAlignedDesktopRelayoutIfNeeded(path);
            scheduleAlignedMobileRelayoutIfNeeded(path);
                resolve(entry);
            } catch (err) {
                console.warn('Image onload error:', path, err);
                if (!skipProgress) { imagesLoaded++; updateLoadingProgressBar(); }
                reject(err);
            }
        };

        img.onerror = () => {
            if (useThumb) {
                loadImageOnce(path, false, skipProgress).then(resolve).catch(() => {
                    if (!skipProgress) { imagesLoaded++; updateLoadingProgressBar(); }
                    reject(new Error('Failed to load image: ' + path));
                });
                return;
            }
            if (!skipProgress) { imagesLoaded++; updateLoadingProgressBar(); }
            reject(new Error('Failed to load image: ' + path));
        };

        img.src = getImageUrl(path, useThumb);
    });
}

// Start loading images when DOM is ready and required elements exist (React may mount after script load)
function runLoadImagesWhenReady() {
    var loadingText = document.getElementById('loadingText');
    var canvasEl = document.getElementById('canvas');
    if (loadingText && canvasEl) {
loadImages();
        return;
    }
    setTimeout(runLoadImagesWhenReady, 50);
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runLoadImagesWhenReady);
} else {
    runLoadImagesWhenReady();
}

// Calculate bounding box (1/5 from top and bottom)
// For mobile: make grid wider than screen for exploration
function getBoundingBox() {
    const isMobile = window.innerWidth < 768 || ('ontouchstart' in window);
    const screenHeight = canvas.height;
    const margin = screenHeight / 5;
    
    let width = canvas.width;
    // On mobile, make grid wider to allow navigation; landscape (tablet): 1.5x so grid is 2x narrower
    if (isMobile) {
        const isLandscape = canvas.width > canvas.height;
        width = isLandscape ? canvas.width * 1.5 : canvas.width * 3;
    }
    
    // Center the random grid around the viewport so its midpoint aligns with the mobile
    // nav intersection ("we are" sits at viewport center). Desktop stays origin-based.
    const offsetX = isMobile ? (canvas.width - width) / 2 : 0;
    
    return {
        x: offsetX,
        y: margin,
        width: width,
        height: screenHeight - (margin * 2)
    };
}

// Generate points with minimum distance constraint. Places ALL images so every image appears in the grid.
function generatePoints(count, minDistance) {
    const box = getBoundingBox();
    const points = [];
    const maxAttempts = 20000;
    
    const shuffledImages = [...imagePaths];
    for (let i = shuffledImages.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledImages[i], shuffledImages[j]] = [shuffledImages[j], shuffledImages[i]];
    }
    
    let imageIndexCounter = 0;
    const usedImages = new Set();
    
    function pickNextUnusedImage() {
        let attempts = 0;
        while (attempts <= shuffledImages.length) {
            const idx = imageIndexCounter % shuffledImages.length;
            const path = shuffledImages[idx];
                imageIndexCounter++;
            attempts++;
            if (!usedImages.has(path)) return path;
        }
                    usedImages.clear();
                    imageIndexCounter = 0;
        return shuffledImages[0];
    }

    function isValidPosition(x, y, currentMinDist) {
        for (let j = 0; j < points.length; j++) {
            const dx = x - points[j].x;
            const dy = y - points[j].y;
            if (Math.sqrt(dx * dx + dy * dy) < currentMinDist) return false;
        }
        return true;
    }

    let pointIndex = 0;
    while (points.length < count) {
        const currentImagePath = pickNextUnusedImage();
        let folderPath = currentImagePath.includes('/') ? currentImagePath.substring(0, currentImagePath.lastIndexOf('/')) : 'final images';
        if (folderPath === currentImagePath || folderPath === '') folderPath = 'final images';

        let placed = false;
        const distancesToTry = [1, 0.85, 0.7, 0.55].map(r => r * minDistance);

        for (let d = 0; d < distancesToTry.length && !placed; d++) {
            const currentMinDist = distancesToTry[d];
            for (let attempt = 0; attempt < maxAttempts && !placed; attempt++) {
                const x = Math.random() * box.width + box.x;
                const y = Math.random() * box.height + box.y;
                if (!isValidPosition(x, y, currentMinDist)) continue;

                const point = {
                    x: x, y: y,
                    baseX: x, baseY: y, originalBaseX: x, originalBaseY: y,
                    layer: (pointIndex % 2 === 0) ? 'layer_1' : 'layer_2',
                    imagePath: currentImagePath,
                    folderPath: folderPath,
                    emojiIndex: pointIndex + 1,
                    isAligned: false, isFiltered: false, filteredFolder: null,
                    targetX: 0, targetY: 0, currentAlignedX: x, currentAlignedY: y,
                    targetSize: 0, currentSize: 0, opacity: 1.0, targetOpacity: 1.0,
                    alignmentStartTime: 0, startX: x, startY: y, startSize: 0,
                    hoverSize: 1.0, isHovered: false, hoverStartTime: 0
                };
                points.push(point);
                usedImages.add(currentImagePath);
                pointIndex++;
                placed = true;
                    break;
                }
            }
        if (!placed) {
            const x = Math.random() * box.width + box.x;
            const y = Math.random() * box.height + box.y;
            const point = {
                x: x, y: y, baseX: x, baseY: y, originalBaseX: x, originalBaseY: y,
                layer: (pointIndex % 2 === 0) ? 'layer_1' : 'layer_2',
                imagePath: currentImagePath, folderPath: folderPath, emojiIndex: pointIndex + 1,
                isAligned: false, isFiltered: false, filteredFolder: null,
                targetX: 0, targetY: 0, currentAlignedX: x, currentAlignedY: y,
                targetSize: 0, currentSize: 0, opacity: 1.0, targetOpacity: 1.0,
                alignmentStartTime: 0, startX: x, startY: y, startSize: 0,
                hoverSize: 1.0, isHovered: false, hoverStartTime: 0
            };
            points.push(point);
            usedImages.add(currentImagePath);
            pointIndex++;
        }
    }
    
    return points;
}

// Grid point count: cap so all points fit with minDistance
const GRID_POINT_COUNT = Math.min(imagePaths.length, 500);
const points = generatePoints(GRID_POINT_COUNT, 50);

// Initialize current sizes and opacity for all points
points.forEach(point => {
    if (point.layer === 'layer_1') {
        point.targetSize = baseEmojiSize;
        point.currentSize = baseEmojiSize;
        point.startSize = baseEmojiSize;
    } else {
        point.targetSize = baseEmojiSize * layer2SizeMultiplier;
        point.currentSize = baseEmojiSize * layer2SizeMultiplier;
        point.startSize = baseEmojiSize * layer2SizeMultiplier;
    }
    point.opacity = 1.0;
    point.targetOpacity = 1.0;
    point.hoverSize = 1.0;
    point.isHovered = false;
    point.hoverStartTime = 0;
});

// Check if mouse is hovering over a point
function isPointHovered(pointX, pointY, mouseX, mouseY, size) {
    const distance = Math.sqrt(
        Math.pow(pointX - mouseX, 2) + 
        Math.pow(pointY - mouseY, 2)
    );
    return distance < size; // Hover radius based on emoji size
}

// Mouse move handler (optimized for performance)
function handleMouseMove(e) {
    markUserInteracted();
    
    // IMPORTANT: Only process mouse moves that target the canvas
    // This prevents hover effects when mouse is over filter buttons or other UI
    if (e.target !== canvas) {
        // Mouse is over UI element - mark as not over canvas
        mouseOverCanvas = false;
        // Clear hover state to prevent zoom
        if (hoveredPoint !== null) {
            hoveredPoint = null;
            hoverStartTime = 0;
            // Restore opacity if not in any special mode
            if (alignedEmojiIndex === null && !isFilterMode && !isConnectionMode) {
                points.forEach(p => {
                    p.targetOpacity = 1.0;
                    p.isHovered = false;
                    p.hoverSize = 1.0;
                });
            }
        }
        return;
    }
    
    // Mouse is over canvas
    mouseOverCanvas = true;
    
    const rect = canvas.getBoundingClientRect();
    const mouseXPos = e.clientX - rect.left;
    const mouseYPos = e.clientY - rect.top;
    
    if (isDragging) {
        // Update last interaction time to prevent accidental clicks
        lastInteractionTime = performance.now();
        
        // Calculate drag delta and update camera pan target directly (more responsive)
        // Allow navigation in all directions (no horizontal-only restriction)
        const deltaX = mouseXPos - lastDragX;
        const deltaY = mouseYPos - lastDragY;
        
        targetCameraPanX += deltaX;
        targetCameraPanY += deltaY;
        
        // Update velocity for inertia (only when dragging, use frame-based calculation)
        const currentTime = performance.now();
        const deltaTime = Math.max(16, currentTime - lastMoveTime); // Cap at ~60fps
        lastMoveTime = currentTime;
        panVelocityX = deltaX / deltaTime;
        panVelocityY = deltaY / deltaTime;
        
        lastDragX = mouseXPos;
        lastDragY = mouseYPos;
        
        // Directly update camera pan for immediate response (no smooth interpolation while dragging)
        cameraPanX = targetCameraPanX;
        cameraPanY = targetCameraPanY;
    } else {
        targetMouseX = mouseXPos;
        targetMouseY = mouseYPos;
        // Decay velocity when not dragging (only needed for inertia after drag ends)
        panVelocityX *= 0.85;
        panVelocityY *= 0.85;
    }
}

// Touch start handler for mobile scroll
let touchStartY = 0;
let touchStartScrollPosition = 0;

function handleTouchStart(e) {
    markUserInteracted();
    
    // IMPORTANT: Only handle events that actually target the canvas
    // This prevents handling touches on filter buttons or other UI elements
    if (e.target !== canvas) {
        return;
    }
    
    // In "we are" mode nothing on canvas is active
    if (isWeAreMode) {
        return;
    }
    
    const isMobile = window.innerWidth < 768 || ('ontouchstart' in window);
    const blockSelection = isMobileVersion && currentMobileCategory === null && alignedEmojiIndex === null && !isFilterMode && !isConnectionMode;
    
    if (e.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        const touchY = e.touches[0].clientY - rect.top;
        lastTouchX = touchX;
        lastTouchY = touchY;
        lastTouchTime = performance.now();
        mobileScrollVelocity = 0;

        touchStartY = e.touches[0].clientY;
        touchStartScrollPosition = mobileScrollPosition;
        
        // Mobile-specific: handle two-tap behavior for images (disabled on random grid home)
        // IMPORTANT: Disable selection mode when pinching (zooming with two fingers)
        if (!blockSelection && isMobile && e.touches.length === 1 && !isFilterMode && !isPinching) {
            // Prevent clicks for 2 seconds after home screen loads
            if (mobileInitialLoadTime !== null) {
                const timeSinceLoad = performance.now() - mobileInitialLoadTime;
                if (timeSinceLoad < MOBILE_INITIAL_CLICK_DELAY) {
                    return; // Ignore clicks during initial 2 second period
                }
            }
            
            // Check if user was recently panning/zooming - if so, don't allow clicks
            // Only apply cooldown if lastInteractionTime was actually set (not 0 from initialization)
            if (lastInteractionTime > 0) {
                const timeSinceLastInteraction = performance.now() - lastInteractionTime;
                if (timeSinceLastInteraction < MOBILE_CLICK_COOLDOWN) {
                    return; // Still in cooldown period after pan/zoom
                }
            }
            
            const clickedPoint = findPointAtMouse(touchX, touchY);
            
            // If not in aligned mode, handle image taps
            if (alignedEmojiIndex === null) {
                if (clickedPoint) {
                    e.preventDefault();
                    
                    // BLOCK: Selection and connection mode not available until all images loaded and 3s cooldown passed
                    if (!isSelectionModeAvailable()) {
                        return; // Block selection/connection mode during loading or cooldown
                    }
                    
                    // BLOCK: When in connection mode, prevent selection of other images until back button is pressed
                    if (isConnectionMode && (!connectedPoints || !connectedPoints.includes(clickedPoint))) {
                        // User is trying to select a different image while in connection mode
                        // Block this action - user must press back button first
                    return;
                }
                    
                    // Check if we're in connection mode and this is a second click within 2 seconds
                    if (isConnectionMode && connectedPoints && connectedPoints.includes(clickedPoint)) {
                        const timeSinceFirstClick = performance.now() - mobileFirstClickTime;
                        if (timeSinceFirstClick <= MOBILE_SELECTION_MODE_DELAY && mobileFirstClickTime > 0) {
                            // Second click within 2 seconds: enter selection mode
                            lastMobileClickTime = performance.now();
                            lastInteractionTime = 0; // Reset to allow immediate action
                    handleEmojiClick(clickedPoint);
                    mobileLastTappedPoint = null;
                            mobileFirstClickTime = 0;
                            exitConnectionMode();
                    return;
                        } else if (timeSinceFirstClick > MOBILE_SELECTION_MODE_DELAY) {
                            // Timeout expired, reset connection mode and start new sequence
                            exitConnectionMode();
                            mobileFirstClickTime = 0;
                        }
                    }
                    
                    // First click: enter connection mode (show dotted lines) - only if not already in connection mode for this point
                    if (!isConnectionMode || !connectedPoints || !connectedPoints.includes(clickedPoint)) {
                        enterConnectionMode(clickedPoint, true); // true = clicked
                        mobileLastTappedPoint = clickedPoint;
                        mobileFirstClickTime = performance.now();
                        // Reset lastInteractionTime to allow second click
                        lastInteractionTime = 0;
                    }
                    return;
                } else {
                    // Clicked outside image - exit connection mode if active
                    if (isConnectionMode) {
                        exitConnectionMode();
                        mobileFirstClickTime = 0;
                    }
                }
            }
        }
        
        // Check if we're in mobile aligned mode
        if (isMobile && alignedEmojiIndex !== null) {
            isMobileScrolling = true;
            scrollIndicatorVisible = true;
            scrollIndicatorFadeTime = performance.now() + 3000;
        }
    }

    // Two-finger pinch to zoom (smooth, native feel)
    if (e.touches.length === 2) {
        const rect = canvas.getBoundingClientRect();
        isPinching = true;
        useContinuousZoom = true;
        // Disable drag while pinching
        isDragging = false;
        // Exit connection mode when user starts pinching (selection mode becomes unavailable)
        if (isConnectionMode) {
            exitConnectionMode();
            mobileFirstClickTime = 0;
        }
        pinchStartDistance = getTouchDistance(e.touches[0], e.touches[1]);
        pinchStartZoom = targetZoomLevel || globalZoomLevel || 1.0;
        const mid = getTouchMidpoint(e.touches[0], e.touches[1]);
        zoomFocalPointX = mid.x - rect.left;
        zoomFocalPointY = mid.y - rect.top;
        isZoomTransitioning = false;
        // Update interaction time to prevent clicks during zoom
        lastInteractionTime = performance.now();
    }
}

// Touch move handler
function handleTouchMove(e) {
    markUserInteracted();
    const isMobile = window.innerWidth < 768 || ('ontouchstart' in window);
    const blockSelection = isMobileVersion && currentMobileCategory === null && alignedEmojiIndex === null && !isFilterMode && !isConnectionMode;
    
    if (e.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        const touchX = e.touches[0].clientX - rect.left;
        const touchY = e.touches[0].clientY - rect.top;
        const now = performance.now();
        
        // Handle mobile vertical scroll when emojis are aligned
        if (isMobile && alignedEmojiIndex !== null) {
            e.preventDefault();
            // Native pinch zoom in selection/gallery mode (iOS/Android)
            if (e.touches.length === 2) {
                var curDist = getTouchDistance(e.touches[0], e.touches[1]);
                if (pinchStartDistance > 0) {
                    var ratio = curDist / pinchStartDistance;
                    var newZoom = pinchStartZoom * ratio;
                    var cX = canvas.width / 2;
                    var cY = canvas.height / 2;
                    var curZ = targetZoomLevel || globalZoomLevel || 1.0;
                    var curPanX = cameraPanX;
                    var curPanY = cameraPanY;
                    newZoom = Math.max(minZoom, Math.min(maxZoom, newZoom));
                    var focX = (zoomFocalPointX != null && zoomFocalPointX !== undefined) ? zoomFocalPointX : cX;
                    var focY = (zoomFocalPointY != null && zoomFocalPointY !== undefined) ? zoomFocalPointY : cY;
                    var wX = ((focX - cX - curPanX) / curZ) + cX;
                    var wY = ((focY - cY - curPanY) / curZ) + cY;
                    targetZoomLevel = newZoom;
                    targetCameraPanX = focX - cX - (wX - cX) * newZoom;
                    targetCameraPanY = focY - cY - (wY - cY) * newZoom;
                    lastInteractionTime = performance.now();
                }
                return;
            }
            // Check if this is a vertical scroll gesture (if not already scrolling, detect it)
            if (!isMobileScrolling) {
                const deltaY = Math.abs(touchY - touchStartY);
                // If vertical movement is significant, start scrolling
                if (deltaY > 10) {
                    isMobileScrolling = true;
                    scrollIndicatorVisible = true;
                    scrollIndicatorFadeTime = performance.now() + 3000;
                }
            }
            
            if (isMobileScrolling) {
                const deltaY = touchY - touchStartY;
                const screenHeight = canvas.height;
                // Convert touch delta to scroll position (0 to 1) - more sensitive
                const scrollDelta = -deltaY / (screenHeight * 1.5); // More sensitive scrolling
                const nextPos = Math.max(0, Math.min(1, touchStartScrollPosition + scrollDelta));
                targetMobileScrollPosition = nextPos;
                mobileScrollVelocity = 0; // Mobile: no inertia, scroll stops when finger lifts
                scrollIndicatorVisible = true;
                scrollIndicatorFadeTime = performance.now() + 3000;
            } else {
                // Normal touch movement for parallax
                targetMouseX = e.touches[0].clientX - rect.left;
                targetMouseY = e.touches[0].clientY - rect.top;
            }
        } else {
            // Pinch zoom (two-finger) — only disabled on mobile when NOT in selection mode
            if (isMobile && e.touches.length === 2) {
                return;
            }

            // One-finger pan (native map feel) + inertia
            e.preventDefault();
            
            // Update last interaction time to prevent accidental clicks
            lastInteractionTime = performance.now();
            
            if (isPinching) {
                isPinching = false;
            }

            const deltaX = touchX - lastTouchX;
            const deltaY = touchY - lastTouchY;
            const dt = Math.max(16, now - lastTouchTime);

            targetCameraPanX += deltaX;
            targetCameraPanY += deltaY;
            cameraPanX = targetCameraPanX;
            cameraPanY = targetCameraPanY;

            panVelocityX = deltaX / dt;
            panVelocityY = deltaY / dt;

            lastTouchX = touchX;
            lastTouchY = touchY;
            lastTouchTime = now;

            // Keep parallax responsive
            targetMouseX = touchX;
            targetMouseY = touchY;
        }

        lastTouchTime = now;
    }
}

// Touch end handler
function handleTouchEnd(e) {
    isMobileScrolling = false;
    if (e.touches.length < 2) {
        isPinching = false;
        // After pinch ends, allow clicks again after a short delay
        if (isMobileDevice()) {
            lastInteractionTime = performance.now();
        }
    }
}

// Mouse leave handler (reset to center)
function handleMouseLeave() {
    // Mouse left the canvas
    mouseOverCanvas = false;
    
    if (!isDragging) {
    targetMouseX = canvas.width / 2;
    targetMouseY = canvas.height / 2;
    }
    
    // Clear hover state when mouse leaves canvas
    if (hoveredPoint !== null) {
        hoveredPoint = null;
        hoverStartTime = 0;
        // If auto-hover connection mode was active, exit it
        if (isConnectionMode && !isConnectionModeClicked) {
            exitConnectionMode();
        }
        // Restore opacity if not in any special mode
        if (alignedEmojiIndex === null && !isFilterMode && !isConnectionMode) {
            points.forEach(p => {
                p.targetOpacity = 1.0;
                p.isHovered = false;
                p.hoverSize = 1.0;
            });
        }
    }
}

// Mouse down handler (start drag or click emoji)
function handleMouseDown(e) {
    markUserInteracted();
    
    // IMPORTANT: Only handle events that actually target the canvas
    // This prevents handling clicks on filter buttons or other UI elements
    if (e.target !== canvas) {
        return;
    }
    
    // Disable image clicks in mobile version (only category navigation is active)
    if (isMobileVersion) {
        return;
    }
    
    // In "we are" mode nothing on canvas is active (only we are text and back/menu)
    if (isWeAreMode) {
        return;
    }
    
    // Prevent accidental clicks right after navigation/zoom
    const timeSinceLastInteraction = performance.now() - lastInteractionTime;
    if (timeSinceLastInteraction < CLICK_DELAY_AFTER_INTERACTION) {
        // Still interacting - start dragging instead
        isDragging = true;
        const rect = canvas.getBoundingClientRect();
        lastDragX = e.clientX - rect.left;
        lastDragY = e.clientY - rect.top;
        canvas.style.cursor = 'grabbing';
        return;
    }
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const clickedPoint = findPointAtMouse(mouseX, mouseY);
    
    // Handle clicks in filter mode
    if (isFilterMode) {
        if (clickedPoint && clickedPoint.isFiltered) {
            handleFilteredImageClick(clickedPoint);
            e.preventDefault();
            return;
        } else if (!clickedPoint) {
            // Allow dragging in filter mode when clicking empty space
            isDragging = true;
            lastDragX = mouseX;
            lastDragY = mouseY;
            canvas.style.cursor = 'grabbing';
            return;
        }
    }
    
    // When in connection mode, click on empty space (not on connected images) returns to home screen
    if (isConnectionMode && !clickedPoint) {
        exitConnectionMode();
        e.preventDefault();
        return;
    }
    
    // When in selection mode (aligned images), allow drag on empty space or aligned image
    if (alignedEmojiIndex !== null) {
        // If clicking on a non-aligned (visible) image, allow selecting it immediately
        if (clickedPoint && !clickedPoint.isAligned && clickedPoint.opacity > 0.01) {
            // BLOCK: Selection mode not available until all images loaded and 3s cooldown passed
            if (!isSelectionModeAvailable()) {
                return; // Block selection during loading or cooldown
            }
            // User clicked on a different image - select it immediately (don't wait for fade in)
            handleEmojiClick(clickedPoint);
            e.preventDefault();
            return;
        }
        // If clicking on an aligned image or empty space, allow drag navigation
        if ((clickedPoint && clickedPoint.isAligned) || !clickedPoint) {
            carouselAutoScrollPaused = true; // Pause carousel on click
            isDragging = true;
            lastDragX = mouseX;
            lastDragY = mouseY;
            canvas.style.cursor = 'grabbing';
        }
    } else if (clickedPoint && !isDragging) {
        // BLOCK: Selection mode not available until all images loaded and 3s cooldown passed
        if (!isSelectionModeAvailable()) {
            return; // Block selection during loading or cooldown
        }
        
        // Check if clicking on an image when hovered lines are visible (after selection appears)
        if (hoveredConnectedPoints.length > 1 && hoveredLinesOpacity > 0.5) {
            // Check if clicked point is in the hovered connected points
            const isInHoveredSet = hoveredConnectedPoints.some(p => p === clickedPoint);
            if (isInHoveredSet) {
                // User sees selection after arrows - align images horizontally using existing logic
                handleEmojiClick(clickedPoint);
                // Clear hover state
                hoveredPoint = null;
                hoverStartTime = 0;
                hoveredConnectedPoints = [];
                hoveredLinesOpacity = 0.0;
                e.preventDefault();
                return;
            }
        }
        
        // Check if clicking on an already hovered image (connection mode - old behavior, keep for compatibility)
        const currentTime = performance.now();
        const clickHoverTimeout = (typeof isMobileDevice === 'function' && isMobileDevice()) ? HOVER_FADE_TIMEOUT : HOVER_FADE_TIMEOUT_WEB;
        if (hoveredPoint === clickedPoint && hoverStartTime > 0 && (currentTime - hoverStartTime) >= clickHoverTimeout && hoveredLinesOpacity < 0.5) {
            // Enter connection mode - draw dotted lines connecting images from same folder
            enterConnectionMode(clickedPoint, true); // true = clicked
            e.preventDefault();
            return;
        }
        
        // BLOCK: When in connection mode, prevent clicking on other images until back button is pressed
        if (isConnectionMode && (!connectedPoints || !connectedPoints.includes(clickedPoint))) {
            // User is trying to click a different image while in connection mode
            // Block this action - user must press back button first
            e.preventDefault();
            return;
        }
        
        // Normal click on image - enter connection mode (show dotted lines)
        if (!isConnectionMode || !connectedPoints || !connectedPoints.includes(clickedPoint)) {
            enterConnectionMode(clickedPoint, true); // true = clicked
            e.preventDefault();
            return;
        }
        
        // If already in connection mode for this point, proceed to selection mode
        handleEmojiClick(clickedPoint);
        e.preventDefault(); // Prevent drag when clicking image
    } else {
        // Start dragging for navigation
        isDragging = true;
        lastDragX = mouseX;
        lastDragY = mouseY;
        canvas.style.cursor = 'grabbing';
    }
}

// Mouse up handler (end drag)
function handleMouseUp() {
    if (isDragging) {
        carouselAutoScrollPaused = false; // Resume carousel when user releases
    }
    isDragging = false;
    canvas.style.cursor = 'default';
    // Velocity will continue to apply inertia after drag ends
}

// Mouse wheel handler (zoom) - smooth, gradual, mouse-relative zoom in selection/filter mode
function handleWheel(e) {
    // Disable zooming on mobile devices
    if (isMobileDevice()) {
        return;
    }
    markUserInteracted();
    e.preventDefault();
    
    // Update last interaction time to prevent accidental clicks
    lastInteractionTime = performance.now();
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Store zoom focal point for smooth interpolation in draw loop
    zoomFocalPointX = mouseX;
    zoomFocalPointY = mouseY;
    
    // If in selection, filter, or connection (dotted line) mode, use smooth gradual zoom/pan at any zoom level
    if (alignedEmojiIndex !== null || isFilterMode || isConnectionMode) {
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        // Selection mode: horizontal wheel/scroll = carousel pan (left-right)
        if (alignedEmojiIndex !== null && !isMobileDevice() && Math.abs(e.deltaX) > 0) {
            const panSensitivity = 1.0;
            targetCameraPanX -= e.deltaX * panSensitivity;
            panVelocityX = -e.deltaX * 0.15;
            panVelocityY = 0;
            e.preventDefault();
            return;
        }
        
        // Mac OS native-style zoom: calculate world position under mouse cursor using CURRENT state
        // Use current interpolated zoom and pan for accurate world position calculation
        const currentZoom = globalZoomLevel; // Use current interpolated zoom (not target)
        const currentPanX = cameraPanX; // Use current interpolated pan (not target)
        const currentPanY = cameraPanY;
        
        // Convert screen mouse position to world coordinates (Mac OS style)
        // Transform: translate(-centerX, -centerY), scale(zoom), translate(centerX + panX, centerY + panY)
        // Reverse: worldX = (screenX - centerX - panX) / zoom + centerX
        const worldX = ((mouseX - centerX - currentPanX) / currentZoom) + centerX;
        const worldY = ((mouseY - centerY - currentPanY) / currentZoom) + centerY;
        
        // Smooth gradual zoom: use exponential scaling based on scroll delta (Mac OS native style)
        // Negative deltaY = zoom in, positive = zoom out
        // Even slower for smoother, more controlled zoom (2x slower)
        const zoomSensitivity = 0.00075; // 2x slower zoom sensitivity
        const zoomDelta = -e.deltaY * zoomSensitivity;
        
        // Calculate target zoom level (exponential scaling for natural feel)
        let newTargetZoom = targetZoomLevel * (1.0 + zoomDelta);
        
        // Clamp to min/max zoom
        newTargetZoom = Math.max(minZoom, Math.min(maxZoom, newTargetZoom));
        
        // If zoom didn't change (hit limit), don't update
        if (Math.abs(newTargetZoom - targetZoomLevel) < 0.001) {
            zoomVelocity = 0; // Reset velocity when hitting limit
            return;
        }
        
        // Update zoom velocity for smooth inertia (based on zoomDelta and time)
        const currentTime = performance.now();
        const timeDelta = currentTime - lastWheelTime;
        if (timeDelta > 0 && timeDelta < 100) { // Only if reasonable time delta
            // Normalize to 16ms (60fps) with 2x reduced inertia strength for slower zoom
            zoomVelocity = zoomDelta / (timeDelta / 16) * 0.75; // 2x reduced inertia multiplier
        } else {
            zoomVelocity = zoomDelta * 0.2; // 2x reduced fallback inertia for first event
        }
        lastWheelTime = currentTime;
        
        // Update target zoom (will be smoothly interpolated in draw loop)
        targetZoomLevel = newTargetZoom;
        isZoomTransitioning = false; // Disable discrete zoom transition, use smooth interpolation
        
        // Mac OS native-style pan adjustment: keep world point under cursor at same screen position
        // Calculate required pan to keep world point at cursor after zoom change
        // Screen position = (worldX - centerX) * zoom + centerX + panX
        // For world point to stay at cursor: mouseX = (worldX - centerX) * newZoom + centerX + newPanX
        // Therefore: newPanX = mouseX - centerX - (worldX - centerX) * newZoom
        const targetPanX = mouseX - centerX - (worldX - centerX) * newTargetZoom;
        const targetPanY = mouseY - centerY - (worldY - centerY) * newTargetZoom;
        
        // Update target pan (will be smoothly interpolated)
        targetCameraPanX = targetPanX;
        targetCameraPanY = targetPanY;
        
        // Update currentZoomIndex to closest discrete level (for compatibility)
        let closestIndex = 0;
        let minDiff = Math.abs(zoomLevels[0] - newTargetZoom);
        for (let i = 1; i < zoomLevels.length; i++) {
            const diff = Math.abs(zoomLevels[i] - newTargetZoom);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = i;
            }
        }
        currentZoomIndex = closestIndex;
    } else {
        // Normal zoom (not in selection mode) - 3 discrete levels: far away, medium, close up
        // Navigate between levels with scroll wheel or trackpad gestures
        if (e.deltaY < 0) {
            // Zoom in (scroll up or pinch out) - move to next higher level
            if (currentZoomIndex < zoomLevels.length - 1) {
                currentZoomIndex++;
                startZoomTransition();
            }
        } else {
            // Zoom out (scroll down or pinch in) - move to next lower level
            if (currentZoomIndex > 0) {
                currentZoomIndex--;
                startZoomTransition();
            }
        }
    }
}

// Start zoom transition with smooth fade
function startZoomTransition() {
    zoomTransitionStartLevel = globalZoomLevel;
    zoomTransitionTargetLevel = zoomLevels[currentZoomIndex];
    zoomTransitionStartTime = performance.now();
    isZoomTransitioning = true;
    targetZoomLevel = zoomTransitionTargetLevel;
}

// Add event listeners - only if canvas exists
if (canvas) {
canvas.addEventListener('mousedown', handleMouseDown);
canvas.addEventListener('mousemove', handleMouseMove);
canvas.addEventListener('mouseup', handleMouseUp);
canvas.addEventListener('wheel', handleWheel, { passive: false });
canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
canvas.addEventListener('mouseleave', handleMouseLeave);

// Carousel: pause on mousedown anywhere, resume on mouseup (selection mode, web only)
document.addEventListener('mousedown', function carouselPauseOnDown() {
    if (alignedEmojiIndex !== null && !isMobileDevice()) carouselAutoScrollPaused = true;
});
document.addEventListener('mouseup', function carouselResumeOnUp() {
    if (alignedEmojiIndex !== null && !isMobileDevice()) carouselAutoScrollPaused = false;
});

// Also add mouseenter to explicitly set mouseOverCanvas = true
canvas.addEventListener('mouseenter', () => {
    mouseOverCanvas = true;
});
}

// Global document listener to catch mouse leaving canvas (throttled to reduce work when moving over page)
var lastDocumentMouseOut = 0;
document.addEventListener('mousemove', (e) => {
    if (e.target !== canvas) {
        if (!mouseOverCanvas) return;
        var now = performance.now();
        if (now - lastDocumentMouseOut < 100) return;
        lastDocumentMouseOut = now;
            mouseOverCanvas = false;
            if (hoveredPoint !== null) {
                const prevHoveredPoint = hoveredPoint;
                hoveredPoint = null;
                hoverStartTime = 0;
                if (prevHoveredPoint) {
                    prevHoveredPoint.isHovered = false;
                    prevHoveredPoint.hoverSize = 1.0;
                }
                if (isConnectionMode && !isConnectionModeClicked) {
                    exitConnectionMode();
            }
        }
    }
}, { passive: true });

// Parallax effect parameters
const parallaxStrength = 0.02; // How much points move (desktop mouse/touch)
const layer1Speed = 1.0; // Speed for layer_1
const layer2Speed = 0.5; // Speed for layer_2 (slower for depth effect)

// Grid rendering cache (pattern-based, much cheaper than per-line loops)
const gridSize = 25;
let gridPatternDesktop = null;
let gridPatternMobile = null;
function getGridPattern() {
    if (!ctx) return null;
    const isMobile = typeof window !== 'undefined' && (window.innerWidth < 768 || ('ontouchstart' in window));
    if (isMobile && gridPatternMobile) return gridPatternMobile;
    if (!isMobile && gridPatternDesktop) return gridPatternDesktop;
    const tile = document.createElement('canvas');
    tile.width = gridSize;
    tile.height = gridSize;
    const tctx = tile.getContext('2d');
    if (!tctx) return null;
    const gridOpacity = isMobile ? 0.24 * 0.8 * 0.8 : 0.24 * 0.8;
    tctx.strokeStyle = `rgba(255, 255, 255, ${gridOpacity})`;
    tctx.lineWidth = 1;
    tctx.beginPath();
    tctx.moveTo(0.5, 0);
    tctx.lineTo(0.5, gridSize);
    tctx.moveTo(0, 0.5);
    tctx.lineTo(gridSize, 0.5);
    tctx.stroke();
    const pattern = ctx.createPattern(tile, 'repeat');
    if (isMobile) gridPatternMobile = pattern; else gridPatternDesktop = pattern;
    return pattern;
}

// Find point at mouse position for click detection
function findPointAtMouse(mouseX, mouseY) {
    // Account for camera zoom and pan when converting mouse coordinates
    // Canvas transform order: translate(-centerX, -centerY), scale(zoom), translate(centerX + panX, centerY + panY)
    // World to screen: (wx - cx) * zoom + cx + panX
    // Screen to world: (sx - cx - panX) / zoom + cx
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const effectiveZoom = globalZoomLevel; // Use current zoom level for accurate detection
    
    // Convert screen coordinates to world coordinates by reversing the transform
    const scaledMouseX = ((mouseX - centerX - cameraPanX) / effectiveZoom) + centerX;
    const scaledMouseY = ((mouseY - centerY - cameraPanY) / effectiveZoom) + centerY;
    
    // Calculate parallax offset for current mouse position
    const offsetX = (scaledMouseX - centerX) * parallaxStrength;
    const offsetY = (scaledMouseY - centerY) * parallaxStrength;
    
    // Check all points and return the closest one that is hovered
    // Check in reverse order so points drawn on top are checked first
    let closestPoint = null;
    let closestDistance = Infinity;
    
    for (let i = points.length - 1; i >= 0; i--) {
        const point = points[i];
        let x, y;
        
        if (point.isAligned || point.isFiltered) {
            x = point.isFiltered ? point.currentAlignedX : point.currentAlignedX;
            y = point.isFiltered ? point.currentAlignedY : point.currentAlignedY;
        } else {
            // Use layer-specific speed for parallax
            const speed = point.layer === 'layer_1' ? layer1Speed : layer2Speed;
            x = point.originalBaseX + (offsetX * speed);
            y = point.originalBaseY + (offsetY * speed);
        }
        
        // Skip inactive points (faded out in selection mode)
        if (point.isInactive) {
            continue; // Skip inactive points - they are not available for interaction
        }
        // Skip effectively invisible points so pan-on-empty-space works after zoom (no invisible hit targets)
        if (point.opacity < 0.15) {
            continue;
        }
        
        // Use appropriate size based on layer and alignment
        let size;
        if (point.isAligned) {
            size = baseEmojiSize * alignedSizeMultiplier;
        } else {
            size = point.layer === 'layer_1' ? baseEmojiSize : baseEmojiSize * layer2SizeMultiplier;
        }
        
        // Check if mouse is within hit radius
        const distance = Math.sqrt(
            Math.pow(x - scaledMouseX, 2) + 
            Math.pow(y - scaledMouseY, 2)
        );
        const hitRadius = size / 2;
        
        if (distance < hitRadius && distance < closestDistance) {
            closestPoint = point;
            closestDistance = distance;
        }
    }
    
    return closestPoint;
}

// Unalign emojis - restore to original positions with animation
function unalignEmojis() {
    if (alignedEmojiIndex === null) return;
    
    const now = performance.now();
    
    // Hide project about text
    hideProjectAboutText();
    
    // Clear connection mode if active
    if (isConnectionMode) {
        exitConnectionMode();
    }
    
    // Exit zoom target: 20% closer than full zoom-out level
    selectionZoomOutExit = selectionTargetZoomOut + (1.0 - selectionTargetZoomOut) * 0.2;
    // Start reverse animation (phase -1): zoom out while images return
    selectionAnimationPhase = -1;
    selectionPhaseStartTime = now;
    selectionStartZoom = globalZoomLevel;
    selectionStartPanX = cameraPanX;
    selectionStartPanY = cameraPanY;
    
    // Store aligned emojis before clearing array
    const emojisToUnalign = [...alignedEmojis];
    
    emojisToUnalign.forEach(p => {
        p.isAligned = false;
        p.targetX = p.originalBaseX;
        p.targetY = p.originalBaseY;
        p.isInactive = false; // Reset inactive flag
        // Reset target size to original size
        if (p.layer === 'layer_1') {
            p.targetSize = baseEmojiSize;
        } else {
            p.targetSize = baseEmojiSize * layer2SizeMultiplier;
        }
        // Initialize animation start values for smooth return
        p.startX = p.currentAlignedX;
        p.startY = p.currentAlignedY;
        p.startSize = p.currentSize;
        p.alignmentStartTime = now;
    });
    
    alignedEmojis = [];
    alignedEmojiIndex = null;
    alignedFolderPath = null;
    alignedRowTotalWidthWorld = 0;
    selectionFocusIndexStored = null;
    selectionBasePanX = 0;
    selectionAnimationHasRunForCurrentAlignment = false;
    
    // Reset mobile scroll state
    mobileScrollPosition = 0;
    targetMobileScrollPosition = 0;
    mobileScrollVelocity = 0;
    mobileAlignedBasePanY = 0;
    mobileAlignedContentHeightWorld = 0;
    mobileAlignedBasePanX = 0;
    mobileMoreBlockCenterYWorld = 0;
    mobileMoreBlockHeightWorld = 0;
    mobileAboutBlockCenterYWorld = 0;
    mobileAboutBlockHeightWorld = 0;
    scrollIndicatorVisible = false;
    mobileLastTappedPoint = null; // Reset mobile tap tracking
    
    panVelocityX = 0;
    panVelocityY = 0;
    
    // Reset mouse position to center (original screen space position)
    targetMouseX = canvas.width / 2;
    targetMouseY = canvas.height / 2;
    smoothMouseX = targetMouseX;
    smoothMouseY = targetMouseY;
    
    // Restore images opacity and reset inactive flag for all points
    points.forEach(p => {
        p.targetOpacity = 1.0;
        p.isInactive = false; // Reset inactive flag
    });
    
    // Set zoom target to default (will be animated by phase -1)
    currentZoomIndex = initialZoomIndex;
    
    // Reset opacity for all images
    points.forEach(p => {
        p.targetOpacity = 1.0;
    });
    
    // Update back button visibility
    updateBackButtonVisibility();
    
    // Hide prev/next buttons with 0.1s fade-out
    hideSelectionNavButtons();
}

/**
 * Show prev/next selection nav buttons (fade in 0.2s)
 */
function showSelectionNavButtons() {
    const prevBtn = document.getElementById('selectionPrevBtn');
    const nextBtn = document.getElementById('selectionNextBtn');
    if (!prevBtn || !nextBtn) return;
    prevBtn.style.display = 'block';
    nextBtn.style.display = 'block';
    prevBtn.style.transition = 'opacity 0.45s cubic-bezier(0.4, 0, 0.2, 1)';
    nextBtn.style.transition = 'opacity 0.45s cubic-bezier(0.4, 0, 0.2, 1)';
    prevBtn.style.opacity = '0';
    nextBtn.style.opacity = '0';
    requestAnimationFrame(() => {
        prevBtn.style.opacity = '1';
        nextBtn.style.opacity = '1';
    });
}

/**
 * Hide prev/next selection nav buttons (smooth slower fade out)
 */
function hideSelectionNavButtons() {
    const prevBtn = document.getElementById('selectionPrevBtn');
    const nextBtn = document.getElementById('selectionNextBtn');
    if (!prevBtn || !nextBtn) return;
    prevBtn.style.transition = 'opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    nextBtn.style.transition = 'opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
    prevBtn.style.opacity = '0';
    nextBtn.style.opacity = '0';
    setTimeout(() => {
        prevBtn.style.display = 'none';
        nextBtn.style.display = 'none';
    }, 250);
}

/**
 * Checks if selection/connection mode is available.
 * Blocks until all images are loaded and cooldown period (2 seconds) has passed.
 * 
 * @returns {boolean} True if selection mode is available, false otherwise
 */
function isSelectionModeAvailable() {
    // Block if images are not fully loaded
    if (!allImagesLoaded || allImagesLoadedTime === null) {
        return false;
    }
    
    // Block if cooldown period (3 seconds) hasn't passed
    const timeSinceLoad = performance.now() - allImagesLoadedTime;
    if (timeSinceLoad < SELECTION_MODE_COOLDOWN) {
        return false;
    }
    
    return true;
}

// Enter connection mode - draw dotted curvy lines connecting images from same folder
function enterConnectionMode(clickedPoint, isClicked = false, allowMobileAuto = false) {
    // Disable user-triggered dotted line animation on mobile (only auto-lines allowed)
    if (isMobileDevice() && !allowMobileAuto) {
        return;
    }
    
    // On mobile homepage random grid, keep images inert (no dotted line animation)
    if (isMobileVersion && currentMobileCategory === null && alignedEmojiIndex === null && !isFilterMode && !isConnectionMode && !allowMobileAuto) {
        return;
    }
    
    // Block if selection mode is not available (images not loaded or cooldown active)
    if (!isSelectionModeAvailable()) {
        return;
    }
    
    // Block connection mode (dotted line animation) for 2 seconds after loading screen
    if (allImagesLoadedTime !== null) {
        const timeSinceLoad = performance.now() - allImagesLoadedTime;
        if (timeSinceLoad < CONNECTION_MODE_COOLDOWN) {
            return; // Block connection mode during 2 second cooldown after loading
        }
    }
    
    // Track if connection mode was entered via click or auto-hover
    isConnectionModeClicked = isClicked;
    
    // Clear any existing alignment/filter/connection
    if (alignedEmojiIndex !== null) {
        unalignEmojis();
    }
    if (isFilterMode) {
        clearFilter();
    }
    
    // Get folder path
    let clickedFolderPath = clickedPoint.folderPath;
    if (!clickedFolderPath) {
        clickedFolderPath = clickedPoint.imagePath.substring(0, clickedPoint.imagePath.lastIndexOf('/'));
        if (clickedFolderPath === clickedPoint.imagePath || clickedFolderPath === '') {
            clickedFolderPath = 'final images';
        }
    }
    
    // Find all images from the same folder
    connectedPoints = points.filter(p => {
        let pFolder = p.folderPath;
        if (!pFolder) {
            pFolder = p.imagePath.substring(0, p.imagePath.lastIndexOf('/'));
            if (pFolder === p.imagePath || pFolder === '') {
                pFolder = 'final images';
            }
        }
        return pFolder === clickedFolderPath;
    });
    
    // Sort by X position (left to right) - but keep images at their original positions
    connectedPoints.sort((a, b) => {
        const aX = a.originalBaseX;
        const bX = b.originalBaseX;
        return aX - bX;
    });
    
    // Ensure all connected points are NOT aligned (stay at original positions)
    connectedPoints.forEach(p => {
        p.isAligned = false;
        p.isFiltered = false;
        // Reset to original positions if they were aligned/filtered
        if (p.targetX !== p.originalBaseX || p.targetY !== p.originalBaseY) {
            p.targetX = p.originalBaseX;
            p.targetY = p.originalBaseY;
            p.startX = p.currentAlignedX || p.originalBaseX;
            p.startY = p.currentAlignedY || p.originalBaseY;
            p.targetSize = p.layer === 'layer_1' ? baseEmojiSize : baseEmojiSize * layer2SizeMultiplier;
            p.startSize = p.currentSize;
            p.alignmentStartTime = performance.now();
        }
    });
    
    isConnectionMode = true;
    connectedFolderPath = clickedFolderPath;
    connectionModeLabelsFadeStartTime = performance.now();
    connectionModeLabelsFadeIn = true;
    
    // Keep images from same folder visible, others fade out
    points.forEach(p => {
        let pFolder = p.folderPath;
        if (!pFolder) {
            pFolder = p.imagePath.substring(0, p.imagePath.lastIndexOf('/'));
            if (pFolder === p.imagePath || pFolder === '') {
                pFolder = 'final images';
            }
        }
        if (pFolder !== clickedFolderPath) {
            p.targetOpacity = 0.0;
        } else {
            p.targetOpacity = 1.0;
        }
    });
    
    // For auto-hover mode, keep hover state so we can detect when mouse moves away
    // For clicked mode, clear hover state
    if (isClicked) {
    hoveredPoint = null;
    hoverStartTime = 0;
    hoveredConnectedPoints = [];
    hoveredLinesOpacity = 0.0;
        autoHoverTriggerPoint = null;
    } else {
        // Auto-hover mode: track the trigger point so we can exit when mouse moves away
        autoHoverTriggerPoint = clickedPoint;
    }
    
    // Reset aligned state to ensure no alignment occurs
    alignedEmojiIndex = null;
    alignedEmojis = [];
    
    updateBackButtonVisibility();
}

// Exit connection mode
function exitConnectionMode() {
    lastConnectedPointsForLabels = connectedPoints.length > 0 ? [...connectedPoints] : [];
    connectionModeLabelsFadeStartTime = performance.now();
    connectionModeLabelsFadeIn = false;
    isConnectionMode = false;
    isConnectionModeClicked = false;
    connectedPoints = [];
    connectedFolderPath = null;
    mobileLastTappedPoint = null; // Reset mobile tap tracking
    autoHoverTriggerPoint = null; // Clear auto-hover trigger point
    
    // Restore opacity for all images and reset inactive flag
    points.forEach(p => {
        p.targetOpacity = 1.0;
        p.isInactive = false; // Reset inactive flag
    });
    
    updateBackButtonVisibility();
}

// Handle emoji click - align all emojis from same folder
function handleEmojiClick(clickedPoint) {
    // Disable image clicks in mobile version (only category navigation is active)
    if (isMobileVersion) {
        return;
    }
    
    // Block if selection mode is not available (images not loaded or cooldown active)
    if (!isSelectionModeAvailable()) {
        return;
    }
    
    // Block if user is pinching (zooming) on mobile
    if (isMobileDevice() && isPinching) {
        return;
    }
    
    // Exit connection mode if active
    if (isConnectionMode) {
        exitConnectionMode();
    }
    // Only handle alignment if nothing is currently aligned (unaligning is handled by mouseDown)
    // Align all emojis from the same folder
    let clickedFolderPath = clickedPoint.folderPath;
    if (!clickedFolderPath) {
        clickedFolderPath = clickedPoint.imagePath.substring(0, clickedPoint.imagePath.lastIndexOf('/'));
        // If no '/' found, it's in root - use 'final images' as folder
        if (clickedFolderPath === clickedPoint.imagePath || clickedFolderPath === '') {
            clickedFolderPath = 'final images';
        }
    }
    
    alignedEmojiIndex = clickedPoint.emojiIndex; // Keep for compatibility
    alignedEmojis = points.filter(p => {
        let pFolder = p.folderPath;
        if (!pFolder) {
            pFolder = p.imagePath.substring(0, p.imagePath.lastIndexOf('/'));
            // If no '/' found, it's in root - use 'final images' as folder
            if (pFolder === p.imagePath || pFolder === '') {
                pFolder = 'final images';
            }
        }
        return pFolder === clickedFolderPath;
    });
    
    // Also find all images from the folder that might not be in points yet
    // (in case we have more images than points)
    const allImagesFromFolder = imagePaths.filter(path => {
        let pathFolder = path.substring(0, path.lastIndexOf('/'));
        if (pathFolder === path || pathFolder === '') {
            pathFolder = 'final images';
        }
        return pathFolder === clickedFolderPath;
    });
    
    // Add any images from folder that aren't in points yet
    allImagesFromFolder.forEach(path => {
        const alreadyInPoints = points.some(p => p.imagePath === path);
        if (!alreadyInPoints) {
            // Create a temporary point for this image (will be added to alignedEmojis but not points)
            const tempPoint = {
                imagePath: path,
                folderPath: clickedFolderPath,
                isAligned: true,
                currentAlignedX: 0,
                currentAlignedY: 0,
                currentSize: baseEmojiSize * alignedSizeMultiplier,
                targetX: 0,
                targetY: 0,
                targetSize: baseEmojiSize * alignedSizeMultiplier,
                targetOpacity: 1.0,
                originalBaseX: 0,
                originalBaseY: 0,
                emojiIndex: -1
            };
            alignedEmojis.push(tempPoint);
        }
    });
    
    alignedFolderPath = clickedFolderPath;
    selectionFocusPointForPhase2 = clickedPoint; // Phase 2: pan to clicked image
    
    // Check if mobile (screen width < 768px or touch device)
    const isMobile = isMobileDevice();
    
    if (isMobile) {
        // Mobile: vertical stack with equal WIDTH, proportional scaling, and 25px gaps
        layoutAlignedEmojisMobileVertical(true);
    } else {
        // Desktop: horizontal row layout (relayouts automatically as images load to prevent overlap)
        layoutAlignedEmojisDesktop(true);
    }
    
    // Set opacity for non-selected images to fade to 0 (completely invisible) in 0.25 seconds
    // For mobile: fade out ALL random grid images completely in selection mode
    // Also mark non-aligned images as inactive for interaction
    points.forEach(p => {
        // Check if this point is in the aligned emojis list
        const isAligned = alignedEmojis.some(aligned => aligned.imagePath === p.imagePath || aligned.emojiIndex === p.emojiIndex);
        
        if (isAligned) {
            p.targetOpacity = 1.0; // Keep aligned images fully visible
            p.isInactive = false; // Active for interaction
        } else {
            // Fade out ALL non-aligned images (complete fade out for random grid) in 0.25 seconds
            p.targetOpacity = 0.0; // Fade to completely invisible
            p.isInactive = true; // Inactive for interaction until back button is pressed
        }
    });
    
    // Load and display about.txt from folder
    loadAndDisplayAboutText(clickedFolderPath);
    
    // Update back button visibility
    updateBackButtonVisibility();
    
    // Show prev/next buttons with 0.2s fade-in (desktop only; horizontal gallery scroll)
    if (!isMobileDevice()) {
        showSelectionNavButtons();
    }
}

// Draw dotted curvy line with arrow from point1 to point2
// Style inspired by MaxMSP/TouchDesigner node connections
function drawCurvedConnectionLine(ctx, x1, y1, x2, y2, drawWidth1, drawHeight1, drawWidth2, drawHeight2) {
    ctx.save();
    
    const LINE_OFFSET = 3; // 3 pixels from image edge
    
    // Line connects only from left or right sides of images
    const img1Left = x1 - drawWidth1 / 2;
    const img1Right = x1 + drawWidth1 / 2;
    
    // Determine which side (left or right) is closest to point2
    const distToLeft = Math.abs(x2 - img1Left);
    const distToRight = Math.abs(x2 - img1Right);
    
    let startX, startY;
    // Always start from the side closest to the destination
    if (distToRight < distToLeft) {
        // Start from right edge
        startX = img1Right + LINE_OFFSET;
        startY = y1;
    } else {
        // Start from left edge
        startX = img1Left - LINE_OFFSET;
        startY = y1;
    }
    
    // Line ends 3 pixels from left or right edge of second image
    const img2Left = x2 - drawWidth2 / 2;
    const img2Right = x2 + drawWidth2 / 2;
    
    // Determine which side (left or right) is closest to point1
    const dist2ToLeft = Math.abs(x1 - img2Left);
    const dist2ToRight = Math.abs(x1 - img2Right);
    
    let endX, endY;
    // Always end at the side closest to the source
    if (dist2ToLeft < dist2ToRight) {
        // End at left edge
        endX = img2Left - LINE_OFFSET;
        endY = y2;
                } else {
        // End at right edge
        endX = img2Right + LINE_OFFSET;
        endY = y2;
    }
    
    // Determine arrow direction (horizontal, pointing toward image)
    const arrowLength = 10;
    let angle;
    if (endX > img2Right) {
        // Arrow is on the right side - point left (toward image)
        angle = Math.PI; // 180 degrees (pointing left)
    } else {
        // Arrow is on the left side - point right (toward image)
        angle = 0; // 0 degrees (pointing right)
    }
    
    // Calculate arrow tip and base positions
    const arrowTipX = endX;
    const arrowTipY = endY;
    const arrowBaseX = endX - arrowLength * Math.cos(angle);
    const arrowBaseY = endY - arrowLength * Math.sin(angle);
    
    // Line should end at arrow base (back of arrow), not at tip
    // This makes the dotted line connect seamlessly to the arrow
    const lineEndX = arrowBaseX;
    const lineEndY = arrowBaseY;
    
    // Node-based software style curve (TouchDesigner/MaxMSP/Blender style)
    // Standard algorithm: control points aligned to exit/entry tangents
    // Calculate distance and direction
    const dx = lineEndX - startX;
    const dy = lineEndY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance < 1) {
        // Too close, draw straight line
        ctx.strokeStyle = '#fff';
        ctx.fillStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(lineEndX, lineEndY);
        ctx.stroke();
        ctx.setLineDash([]);
        return;
    }
    
    // Determine exit and entry directions (horizontal: left or right)
    // Exit direction: which side of image1 we're leaving from
    // (img1Left and img1Right are already defined above)
    const exitRight = (startX >= img1Right);
    const exitLeft = (startX <= img1Left);
    
    // Entry direction: which side of image2 we're entering from
    // (img2Left and img2Right are already defined above)
    const entryRight = (lineEndX >= img2Right);
    const entryLeft = (lineEndX <= img2Left);
    
    // Control point distance: proportional to line length (standard: 1/3 of distance)
    // Clamp between min and max for natural curves
    const baseControlDistance = distance * 0.33; // Standard node-based software uses ~1/3
    const minControlDistance = Math.min(30, distance * 0.15); // Minimum for short lines
    const maxControlDistance = Math.min(150, distance * 0.5); // Maximum for long lines
    const controlDistance = Math.max(minControlDistance, Math.min(maxControlDistance, baseControlDistance));
    
    // First control point: aligned to exit tangent (horizontal)
    // Positioned along the exit direction (left or right)
    let cp1X, cp1Y;
    if (exitRight) {
        // Exiting to the right - control point extends rightward
        cp1X = startX + controlDistance;
        cp1Y = startY; // Keep Y aligned for horizontal tangent
            } else {
        // Exiting to the left - control point extends leftward
        cp1X = startX - controlDistance;
        cp1Y = startY; // Keep Y aligned for horizontal tangent
    }
    
    // Second control point: aligned to entry tangent (horizontal, pointing toward arrow)
    // Positioned along the entry direction
    let cp2X, cp2Y;
    if (entryRight) {
        // Entering from the right - control point extends rightward from end
        cp2X = lineEndX + controlDistance;
        cp2Y = lineEndY; // Keep Y aligned for horizontal tangent
    } else {
        // Entering from the left - control point extends leftward from end
        cp2X = lineEndX - controlDistance;
        cp2Y = lineEndY; // Keep Y aligned for horizontal tangent
    }
    
    // Add subtle vertical curvature for natural S-curve
    // Only add perpendicular offset if there's significant vertical difference
    const verticalDiff = Math.abs(dy);
    if (verticalDiff > 20) {
        // Add subtle perpendicular offset (10-20% of vertical difference)
        const perpX = -dy / distance;
        const perpY = dx / distance;
        const curveAmount = Math.min(verticalDiff * 0.15, 40); // Max 40px curve
        
        // Apply offset to control points (opposite directions for S-curve)
        cp1X += perpX * curveAmount;
        cp1Y += perpY * curveAmount;
        cp2X -= perpX * curveAmount; // Opposite direction for S-curve
        cp2Y -= perpY * curveAmount;
    }
    
    ctx.strokeStyle = '#fff';
    ctx.fillStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([5, 5]); // Dotted line: 5px dash, 5px gap
    
    // Draw node-based software style curve (natural S-curve with horizontal tangents)
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    // Cubic bezier with control points aligned to exit/entry tangents
    ctx.bezierCurveTo(cp1X, cp1Y, cp2X, cp2Y, lineEndX, lineEndY);
    ctx.stroke();
    
    // Reset line dash for arrow (solid)
    ctx.setLineDash([]);
    
    // Draw arrow at the end (connected to line)
    ctx.beginPath();
    ctx.moveTo(arrowTipX, arrowTipY);
    ctx.lineTo(
        arrowTipX - arrowLength * Math.cos(angle - Math.PI / 6),
        arrowTipY - arrowLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
        arrowTipX - arrowLength * Math.cos(angle + Math.PI / 6),
        arrowTipY - arrowLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    
    ctx.restore();
}

// Helper function to clear all hover state
function clearHoverState() {
    hoveredPoint = null;
    hoverStartTime = 0;
    hoveredConnectedPoints = [];
    hoveredLinesOpacity = 0.0;
    // Reset hover zoom on all points
    points.forEach(p => {
        p.isHovered = false;
        p.hoverSize = 1.0;
    });
}

// Filter functions - now implements index mode with folder list
function filterByTag(tag) {
    // Clear "we are" mode when switching to another menu section
    if (isWeAreMode) {
        clearWeAreMode();
    }
    // When navigating menus: hide project about and prev/next so they don't persist
    hideProjectAboutText();
    hideSelectionNavButtons();
    // Clear hover state first to prevent image zoom
    clearHoverState();
    
    // Clear any existing alignment/connection first
    if (alignedEmojiIndex !== null) {
        unalignEmojis();
    }
    if (isConnectionMode) {
        exitConnectionMode();
    }
    
    // If clicking the same tag while in index mode, clear it
    if (indexModeTag === tag && isIndexMode) {
        exitIndexMode();
        return;
    }
    
    // Map tag to search term (handle 'install' -> 'installation')
    const searchTag = tag === 'install' ? 'installation' : tag;
    
    // Find all unique folders that match this tag using FOLDER_TAGS mapping
    const foldersWithTag = new Map(); // folderPath -> folderDisplayName
    
    points.forEach(point => {
        const folderPath = point.folderPath || point.imagePath.substring(0, point.imagePath.lastIndexOf('/'));
        if (folderPath.includes('/0_')) return; // hide 0_ prefixed projects from menus
        const folderName = (folderPath.split('/').pop() || '').trim();
        
        // Check if this folder has the tag (supports embedded hashtags or manual map)
        const folderTags = getFolderTags(folderName);
        if (folderTags && folderTags.includes(searchTag)) {
            if (!foldersWithTag.has(folderPath)) {
                foldersWithTag.set(folderPath, folderName);
            }
        }
    });
    
    if (foldersWithTag.size === 0) {
        console.warn(`No folders found with tag: ${searchTag}`);
        return;
    }
    
    // Enter index mode
    isIndexMode = true;
    indexModeTag = tag;
    indexModeFolders = Array.from(foldersWithTag.entries()).map(([path, name]) => ({
        path: path,
        name: name
    }));
    selectedIndexFolder = null;
    
    // Clear any hover state
    hoveredPoint = null;
    hoverStartTime = 0;
    hoveredConnectedPoints = [];
    hoveredLinesOpacity = 0.0;
    
    // Fade out images/lines when entering folder list (mobile: 0.25s intent)
    points.forEach(p => {
        p.targetOpacity = 0.0;
        p.isInactive = true;
        p.isHovered = false;
        p.hoverSize = 1.0;
    });
    // Stop/clear auto dotted lines immediately
    stopMobileAutoConnections();
    mobileAutoLines = [];
    
    // Show folder list on the left side
    showIndexFolderList(indexModeFolders);
    
    // Mobile: hide navigation and show back button in folder list mode
    if (isMobileDevice()) {
        setMobileNavVisibility(false); // Hide nav labels in folder list mode
        
        // Show mobileCategoryContent but keep inner content hidden (so back button is visible)
        const categoryContent = document.getElementById('mobileCategoryContent');
        if (categoryContent) {
            categoryContent.classList.add('visible');
            categoryContent.style.visibility = 'visible';
            categoryContent.style.opacity = '1';
            categoryContent.style.pointerEvents = 'none'; // Let clicks pass through to folder list
            categoryContent.style.background = 'transparent';
        }
        
        // Hide the inner content completely
        const contentInner = document.querySelector('.mobile-category-content-inner');
        if (contentInner) {
            contentInner.style.display = 'none';
            contentInner.style.visibility = 'hidden';
            contentInner.style.opacity = '0';
        }
        
        // Also hide title/body specifically
        const categoryTitle = document.getElementById('mobileCategoryTitle');
        const categoryBody = document.getElementById('mobileCategoryBody');
        if (categoryTitle) categoryTitle.style.display = 'none';
        if (categoryBody) categoryBody.style.display = 'none';
        
        const mobileBack = document.getElementById('mobileCategoryBack');
        if (mobileBack) {
            mobileBack.style.setProperty('display', 'flex', 'important');
            mobileBack.style.setProperty('visibility', 'visible', 'important');
            mobileBack.style.setProperty('opacity', '1', 'important');
            mobileBack.style.position = 'fixed';
            mobileBack.style.left = '14px';
            mobileBack.style.right = '14px';
            mobileBack.style.bottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
            mobileBack.style.top = 'auto';
            mobileBack.style.background = 'transparent';
            mobileBack.style.pointerEvents = 'auto';
            mobileBack.style.zIndex = '20001';
        }
    }
    
    // Show back button
    updateBackButtonVisibility();
    
    // Update filter button state
    currentFilterTag = tag;
    updateFilterButtons();
}

// Show the folder list UI with staggered animation
function showIndexFolderList(folders) {
    const container = document.getElementById('indexFolderList');
    if (!container) return;
    
    // Clear existing items
    container.innerHTML = '';
    container.style.background = 'transparent';
    container.style.pointerEvents = 'auto';
    
    const isMobile = isMobileDevice();
    
    if (isMobile) {
        container.style.left = '14px';
        container.style.right = '14px';
        container.style.top = '120px';
        container.style.bottom = 'auto';
        container.style.transform = 'none';
        container.style.width = 'calc(100% - 28px)';
        container.style.alignItems = 'flex-start';
        container.style.gap = '10px';
        container.style.overflowY = 'auto';
        container.style.maxHeight = '70vh';
        container.style.setProperty('display', 'flex', 'important');
        container.style.zIndex = '20000';
        
        // Hide mobile nav in folder list mode
        setMobileNavVisibility(false);
        
        // Show mobileCategoryContent but keep inner content hidden (so back button is visible)
        const categoryContent = document.getElementById('mobileCategoryContent');
        if (categoryContent) {
            categoryContent.classList.add('visible');
            categoryContent.style.visibility = 'visible';
            categoryContent.style.opacity = '1';
            categoryContent.style.pointerEvents = 'none'; // Let clicks pass through to folder list
            categoryContent.style.background = 'transparent';
        }
        
        // Hide the inner content completely
        const contentInner = document.querySelector('.mobile-category-content-inner');
        if (contentInner) {
            contentInner.style.display = 'none';
            contentInner.style.visibility = 'hidden';
            contentInner.style.opacity = '0';
        }
        
        // Also hide title/body specifically
        const categoryTitle = document.getElementById('mobileCategoryTitle');
        const categoryBody = document.getElementById('mobileCategoryBody');
        if (categoryTitle) categoryTitle.style.display = 'none';
        if (categoryBody) categoryBody.style.display = 'none';
        
        // Ensure mobile back is visible in folder list mode
        const mobileBack = document.getElementById('mobileCategoryBack');
        if (mobileBack) {
            mobileBack.style.setProperty('display', 'flex', 'important');
            mobileBack.style.setProperty('visibility', 'visible', 'important');
            mobileBack.style.setProperty('opacity', '1', 'important');
            mobileBack.style.position = 'fixed';
            mobileBack.style.left = '14px';
            mobileBack.style.right = '14px';
            mobileBack.style.bottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
            mobileBack.style.top = 'auto';
            mobileBack.style.background = 'transparent';
            mobileBack.style.pointerEvents = 'auto';
            mobileBack.style.zIndex = '20001';
        }
    } else {
        container.style.left = '50px';
        container.style.right = 'auto';
        container.style.top = '50%';
        container.style.bottom = 'auto';
        container.style.transform = 'translateY(-50%)';
        container.style.width = 'auto';
        container.style.alignItems = 'flex-start';
        container.style.gap = '12px';
        container.style.overflowY = '';
        container.style.maxHeight = '';
        container.style.removeProperty('display');
        container.style.zIndex = '';
    }
    
    // Create folder items
    folders.forEach((folder, index) => {
        const item = document.createElement('div');
        item.className = 'index-folder-item';
        // Display clean folder name without hashtags (text before "#")
        const cleanName = (folder.name || '').replace(/\s*#.*$/, '').trim() || folder.name;
        item.textContent = cleanName;
        item.dataset.folderPath = folder.path;
        
        // Add click handler
        item.addEventListener('click', () => {
            selectIndexFolder(folder.path, cleanName);
        });
        
        container.appendChild(item);
        
        // Staggered appearance animation (0.1s delay per item)
        setTimeout(() => {
            item.classList.add('visible');
        }, index * 100);
    });
    
    // Show container
    container.classList.add('visible');
}

// Hide the folder list UI
function hideIndexFolderList() {
    const container = document.getElementById('indexFolderList');
    if (!container) return;
    
    // IMMEDIATELY disable pointer events to restore touch navigation
    container.style.pointerEvents = 'none';
    
    // Fade out all items
    const items = container.querySelectorAll('.index-folder-item');
    items.forEach(item => {
        item.classList.remove('visible');
        item.classList.add('fading-out');
    });
    
    // Hide container after animation
    setTimeout(() => {
        container.classList.remove('visible');
        container.innerHTML = '';
        
        // CRITICAL: Reset inline styles completely
        // These styles were set by showIndexFolderList() and must be cleared
        container.style.removeProperty('display');
        container.style.zIndex = '';
    }, 250); // 0.25s fade
}

// Select a folder from the index list
function selectIndexFolder(folderPath, folderName) {
    selectedIndexFolder = folderPath;
    
    // Mobile: ensure back button stays fixed on top
    if (isMobileDevice()) {
        const categoryContent = document.getElementById('mobileCategoryContent');
        if (categoryContent) {
            categoryContent.classList.add('visible');
            categoryContent.style.pointerEvents = 'auto';
            categoryContent.style.visibility = 'visible';
            categoryContent.style.opacity = '1';
            categoryContent.style.background = 'transparent';
        }
        const mobileBack = document.getElementById('mobileCategoryBack');
        if (mobileBack) {
            mobileBack.style.display = 'flex';
            mobileBack.style.visibility = 'visible';
            mobileBack.style.opacity = '1';
            mobileBack.style.position = 'fixed';
            mobileBack.style.left = '14px';
            mobileBack.style.right = '14px';
            mobileBack.style.bottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
            mobileBack.style.top = 'auto';
            mobileBack.style.background = 'transparent';
            mobileBack.style.backgroundColor = 'transparent';
            mobileBack.style.pointerEvents = 'auto';
            mobileBack.style.zIndex = '20000';
        }
    }
    
    // Fade out other folder items
    const container = document.getElementById('indexFolderList');
    if (container) {
        const items = container.querySelectorAll('.index-folder-item');
        items.forEach(item => {
            if (item.dataset.folderPath !== folderPath) {
                item.classList.add('fading-out');
            } else {
                item.classList.add('active');
            }
        });
    }
    
    // Find all images in this folder
    const folderImages = points.filter(p => {
        const pFolder = p.folderPath || p.imagePath.substring(0, p.imagePath.lastIndexOf('/'));
        return pFolder === folderPath;
    });
    
    if (folderImages.length === 0) {
        console.warn(`No images found in folder: ${folderPath}`);
        return;
    }
    
    // Immediately hide folder list (it will fade out via CSS)
    hideIndexFolderList();
    
    // Directly trigger selection mode for this folder
    // This is a modified version of handleEmojiClick that works smoothly from index mode
    // For mobile: snap layout (no animation) to avoid stuck small images
    if (isMobileDevice()) {
        enterSelectionModeForFolder(folderPath, folderImages, false);
    } else {
        enterSelectionModeForFolder(folderPath, folderImages, true);
    }
}

// Enter selection mode for a folder (called from index mode)
function enterSelectionModeForFolder(folderPath, folderImages, animateLayout = true) {
    // Set up alignment state
    alignedEmojiIndex = folderImages[0].emojiIndex;
    alignedEmojis = folderImages;
    alignedFolderPath = folderPath;
    
    if (isMobileDevice()) {
        // Mobile: align in a simple vertical column (10% left padding, 60% width), non-interactive
    folderImages.forEach(p => {
        p.isAligned = true;
            p.isInactive = true; // non-clickable
        p.targetOpacity = 1.0;
    });
        // Fade out others
    points.forEach(p => {
        if (!folderImages.includes(p)) {
            p.targetOpacity = 0.0;
            p.isInactive = true;
        }
    });
    alignedEmojis = folderImages;
    layoutAlignedEmojisMobileVertical(false); // snap into place
    if (isMobileDevice()) {
        setMobileNavVisibility(false); // keep nav/buttons hidden during selection
    }
    } else {
        // DESKTOP: keep existing behavior
        folderImages.forEach(p => {
            p.isAligned = true;
            p.isInactive = true; // keep inactive / unclickable
            p.targetOpacity = 1.0;
        });
        points.forEach(p => {
            if (!folderImages.includes(p)) {
                p.targetOpacity = 0.0;
                p.isInactive = true;
            }
        });
        selectionFocusPointForPhase2 = null; // From menu: phase 2 will pick center-closest
        layoutAlignedEmojisDesktop(true);
    }
    
    // Load and display about.txt
    loadAndDisplayAboutText(folderPath);
    
    // Update UI
    updateBackButtonVisibility();

    // Mobile: force back button visible/top in selection mode
    if (isMobileDevice()) {
        const mobileBack = document.getElementById('mobileCategoryBack');
        if (mobileBack) {
            mobileBack.style.display = 'flex';
            mobileBack.style.visibility = 'visible';
            mobileBack.style.opacity = '1';
            mobileBack.style.position = 'fixed';
            mobileBack.style.left = '14px';
            mobileBack.style.right = '14px';
            mobileBack.style.bottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
            mobileBack.style.top = 'auto';
            mobileBack.style.background = 'transparent';
            mobileBack.style.backgroundColor = 'transparent';
            mobileBack.style.pointerEvents = 'auto';
            mobileBack.style.zIndex = '20000';
        }
    } else {
        showSelectionNavButtons();
    }
}

// Exit index mode completely
function exitIndexMode() {
    isIndexMode = false;
    indexModeTag = null;
    indexModeFolders = [];
    selectedIndexFolder = null;
    currentFilterTag = null;
    
    // Hide folder list
    hideIndexFolderList();
    
    // Hide project about text and selection nav buttons
    hideProjectAboutText();
    hideSelectionNavButtons();
    
    // Hide mobile category content overlay to restore touch navigation
    if (isMobileDevice()) {
        const categoryContent = document.getElementById('mobileCategoryContent');
        if (categoryContent) {
            categoryContent.classList.remove('visible');
            categoryContent.style.pointerEvents = 'none';
            categoryContent.style.visibility = 'hidden';
            categoryContent.style.opacity = '0';
        }
        const contentInner = document.querySelector('.mobile-category-content-inner');
        if (contentInner) {
            contentInner.style.display = 'none';
            contentInner.style.visibility = 'hidden';
            contentInner.style.opacity = '0';
        }
    }
    
    // Restore all images
    points.forEach(p => {
        p.targetOpacity = 1.0;
        p.isInactive = false;
        p.isFiltered = false;
    });
    
    // Reset camera
    currentZoomIndex = initialZoomIndex;
    startZoomTransition();
    targetCameraPanX = initialCameraPanX;
    targetCameraPanY = initialCameraPanY;
    
    updateFilterButtons();
    updateBackButtonVisibility();
    if (isMobileDevice()) {
        setMobileNavVisibility(true);
    }
}

// Return to folder selection from image selection
function returnToFolderSelection() {
    if (!isIndexMode) return;
    
    // Hide about text and prev/next immediately so they fade out when going back to menu
    hideProjectAboutText();
    hideSelectionNavButtons();
    
    resetMobileSelectionLayout();
    
    selectedIndexFolder = null;
    
    // Clear hover state
    hoveredPoint = null;
    hoverStartTime = 0;
    hoveredConnectedPoints = [];
    hoveredLinesOpacity = 0.0;
    
    // Unalign any aligned images
    if (alignedEmojiIndex !== null) {
        unalignEmojis();
    }
    
    // Fade out all images and make them inactive
    points.forEach(p => {
        p.targetOpacity = 0.0;
        p.isInactive = true;
        p.isHovered = false;
        p.hoverSize = 1.0;
    });
    
    // Re-show folder list
    showIndexFolderList(indexModeFolders);
    
    // Reset camera
    currentZoomIndex = initialZoomIndex;
    startZoomTransition();
    targetCameraPanX = 0;
    targetCameraPanY = 0;
    if (isMobileDevice()) {
        setMobileNavVisibility(false); // stay hidden in folder list mode
    }
}

function clearFilter() {
    // If in index mode, handle that instead
    if (isIndexMode) {
        if (selectedIndexFolder !== null) {
            // Return to folder selection first
            returnToFolderSelection();
        } else {
            // Exit index mode completely
            exitIndexMode();
        }
        return;
    }
    
    if (!isFilterMode) return;
    
    // Hide project about text
    hideProjectAboutText();
    
    currentFilterTag = null;
    isFilterMode = false;
    
    // Restore all points to original positions
    filteredImages.forEach(point => {
        point.isFiltered = false;
        point.targetX = point.originalBaseX;
        point.targetY = point.originalBaseY;
        point.targetSize = point.layer === 'layer_1' ? baseEmojiSize : baseEmojiSize * layer2SizeMultiplier;
        point.targetOpacity = 1.0;
        point.startX = point.currentAlignedX;
        point.startY = point.currentAlignedY;
        point.startSize = point.currentSize;
        point.alignmentStartTime = performance.now();
    });
    
    filteredImages = [];
    
    // Restore opacity for all images and reset inactive flag
    points.forEach(p => {
        p.targetOpacity = 1.0;
        p.isInactive = false; // Reset inactive flag
    });
    
    // Reset camera
    currentZoomIndex = initialZoomIndex;
    startZoomTransition();
    targetCameraPanX = initialCameraPanX;
    targetCameraPanY = initialCameraPanY;
    cameraPanX = initialCameraPanX;
    cameraPanY = initialCameraPanY;
    
    updateFilterButtons();
    updateBackButtonVisibility();
}

function handleFilteredImageClick(clickedPoint) {
    if (!isFilterMode || !clickedPoint.isFiltered) return;
    
    // Get all images from the same folder
    const folderPath = clickedPoint.filteredFolder || clickedPoint.imagePath.substring(0, clickedPoint.imagePath.lastIndexOf('/'));
    const folderImages = points.filter(p => {
        const pFolder = p.imagePath.substring(0, p.imagePath.lastIndexOf('/'));
        return pFolder === folderPath;
    });
    
    if (folderImages.length === 0) return;
    
    // Clear current filter and align folder images
    clearFilter();
    
    // Align folder images (desktop horizontal layout; relayouts as images load)
    selectionFocusPointForPhase2 = clickedPoint; // Phase 2: pan to clicked image
    alignedEmojiIndex = clickedPoint.imageIndex;
    alignedEmojis = folderImages;
    alignedFolderPath = folderPath;
    layoutAlignedEmojisDesktop(true);
    
    // Set opacity for non-selected images (group by folder)
    const clickedFolderForAlignment = clickedPoint.folderPath || clickedPoint.imagePath.substring(0, clickedPoint.imagePath.lastIndexOf('/'));
    points.forEach(p => {
        const pFolder = p.folderPath || p.imagePath.substring(0, p.imagePath.lastIndexOf('/'));
        if (pFolder !== clickedFolderForAlignment) {
            p.targetOpacity = 0.0;
        } else {
            p.targetOpacity = 1.0;
        }
    });
    
    updateBackButtonVisibility();
}

function updateFilterButtons() {
    const buttons = document.querySelectorAll('.filter-button');
    buttons.forEach(btn => {
        if (btn.id === 'weAreButton') return;
        const tag = btn.getAttribute('data-tag');
        if (tag === currentFilterTag) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function positionFilterButtons() {
    const buttons = document.querySelectorAll('.filter-button:not(#weAreButton)');
    const screenWidth = window.innerWidth;
    const isMobile = window.innerWidth < 768 || ('ontouchstart' in window);
    
    // Reuse a single canvas context for text measurement (avoid DOM churn on resize)
    if (!positionFilterButtons._measureCtx) {
    const tempCanvas = document.createElement('canvas');
        positionFilterButtons._measureCtx = tempCanvas.getContext('2d');
    }
    const tempCtx = positionFilterButtons._measureCtx;
    
    // Scale font size for mobile to fit screen
    const baseFontSize = isMobile ? 11 : 14; // Smaller font for mobile
    tempCtx.font = `${baseFontSize}px Arial`; // Match button font
    
    // Measure spacebar and dash widths
    const spaceWidth = tempCtx.measureText(' ').width;
    const threeSpacesWidth = spaceWidth * 3; // 3 spacebars
    const dashText = '––––––––––'; // 8 dashes
    const dashWidth = tempCtx.measureText(dashText).width;
    const totalSpacingWidth = threeSpacesWidth + dashWidth + threeSpacesWidth; // 3 spaces + 8 dashes + 3 spaces
    
    // Find "stage design" button - it's the first one, at 1/3 from left
    const stageDesignBtn = Array.from(buttons).find(btn => btn.textContent.trim().toLowerCase() === 'stage design');
    const weAreBtn = document.getElementById('weAreButton');
    const backBtn = document.getElementById('backButton');
    
    // For mobile: calculate scale factor to fit all buttons and back button
    let scale = 1;
    let startX = screenWidth / 3;
    
    if (isMobile) {
        // Calculate total width needed for all buttons
        let totalButtonsWidth = 0;
        buttons.forEach(btn => {
            const textWidth = tempCtx.measureText(btn.textContent).width;
            totalButtonsWidth += textWidth + spaceWidth;
        });
        const weAreTextWidth = tempCtx.measureText(weAreBtn.textContent).width;
        const backBtnWidth = backBtn ? tempCtx.measureText(backBtn.textContent || 'back').width + 40 : 0; // Add padding for back button
        
        // Calculate available space (leave margin for back button on right)
        const availableWidth = screenWidth - startX - backBtnWidth - 20; // 20px margin
        
        // Scale down if needed
        if (totalButtonsWidth + totalSpacingWidth + weAreTextWidth > availableWidth) {
            scale = availableWidth / (totalButtonsWidth + totalSpacingWidth + weAreTextWidth + 40); // 40px extra margin
            scale = Math.max(0.7, Math.min(1, scale)); // Clamp between 0.7 and 1
        }
        
        // Update font size for mobile buttons
        buttons.forEach(btn => {
            btn.style.fontSize = `${baseFontSize * scale}px`;
        });
        if (weAreBtn) {
            weAreBtn.style.fontSize = `${baseFontSize * scale}px`;
        }
    } else {
        // Desktop: use original font size
        buttons.forEach(btn => {
            btn.style.fontSize = `${baseFontSize}px`;
        });
        if (weAreBtn) {
            weAreBtn.style.fontSize = `${baseFontSize}px`;
        }
    }
    
    // Position "stage design" and other buttons starting at 1/3 from left
    let currentX = startX;
    
    buttons.forEach((btn) => {
        btn.style.left = `${currentX}px`;
        btn.style.position = 'absolute';
        btn.style.transform = 'translateX(0)';
        
        // Measure button text width and add one space for next button
        const textWidth = tempCtx.measureText(btn.textContent).width * scale;
        currentX += textWidth + (spaceWidth * scale); // Button width + one space
    });
    
    // Position "we are" button to the left of "stage design" with: 3 spaces + 8 dashes + 3 spaces
    if (stageDesignBtn && weAreBtn) {
        const stageDesignLeft = startX; // Stage design is at 1/3 from left
        const weAreTextWidth = tempCtx.measureText(weAreBtn.textContent).width * scale;
        const scaledSpacingWidth = totalSpacingWidth * scale;
        // Add a small fixed cushion so long "we are" labels never touch the dash separator
        const separatorPadding = 10 * scale;
        // Position we are button so that total spacing (3 spaces + 8 dashes + 3 spaces) fits between it and stage design
        const weAreLeft = stageDesignLeft - scaledSpacingWidth - weAreTextWidth - separatorPadding;
        weAreBtn.style.left = `${weAreLeft}px`;
        weAreBtn.style.position = 'absolute';
        weAreBtn.style.right = 'auto';
        
        // Create separator element with 3 spaces + 8 dashes + 3 spaces
        const existingDash = document.getElementById('dashSeparator');
        if (existingDash) {
            existingDash.remove();
        }
        const separatorSpan = document.createElement('span');
        separatorSpan.id = 'dashSeparator';
        separatorSpan.className = 'filter-button';
        separatorSpan.textContent = '\u00A0\u00A0\u00A0' + dashText + '\u00A0\u00A0\u00A0'; // 3 non-breaking spaces + 8 dashes + 3 non-breaking spaces
        separatorSpan.style.position = 'absolute';
        separatorSpan.style.left = `${weAreLeft + weAreTextWidth}px`;
        separatorSpan.style.pointerEvents = 'none'; // Don't allow clicks on separator
        separatorSpan.style.opacity = '1';
        separatorSpan.style.color = '#fff';
        separatorSpan.style.fontSize = `${baseFontSize * scale}px`;
        separatorSpan.style.fontFamily = 'Arial, sans-serif';
        separatorSpan.style.textTransform = 'lowercase';
        document.getElementById('filterButtons').appendChild(separatorSpan);
    }
}

// Show "We are" about text
function showWeAreAbout() {
    // Clear hover state first to prevent image zoom
    clearHoverState();
    
    // Hide project about and selection nav when entering we are
    hideProjectAboutText();
    hideSelectionNavButtons();
    
    // Clear any existing filter/alignment/connection first
    if (isFilterMode) {
        clearFilter();
    }
    if (alignedEmojiIndex !== null) {
        unalignEmojis();
    }
    if (isConnectionMode) {
        exitConnectionMode();
    }
    
    // If coming from index mode (folder list), hide it and exit index state so only we are text is visible
    if (isIndexMode) {
        hideIndexFolderList();
        isIndexMode = false;
        indexModeTag = null;
        indexModeFolders = [];
        selectedIndexFolder = null;
        currentFilterTag = null;
        if (isMobileDevice()) {
            setMobileNavVisibility(false);
        }
    }
    
    // Fade out all images and make everything inactive until another action (back or menu click)
    points.forEach(p => {
        p.targetOpacity = 0.0;
        p.isInactive = true;
    });
    
    isWeAreMode = true;
    
    // Display about text from embedded constant
    const aboutTextEl = document.getElementById('aboutText');
    const aboutContent = getAboutText();
    if (aboutTextEl && aboutContent) {
        // Format text: preserve line breaks
        aboutTextEl.innerHTML = aboutContent.split('\n').map(line => {
            const t = line.trim();
            if (t === '') return '<br>';
            if (t.startsWith('<')) return t;
            return `<p>${line}</p>`;
        }).join('');
        aboutTextEl.style.display = 'block';
        const weAreBtn = document.getElementById('weAreButton');
        if (weAreBtn) {
            const rect = weAreBtn.getBoundingClientRect();
            aboutTextEl.style.left = `${rect.left}px`;
        }
        aboutTextEl.style.opacity = '0';
        // Fade in after images fade out (1 second)
        setTimeout(() => {
            aboutTextEl.style.opacity = '1';
        }, 1000);
    } else {
        console.error('About text not available or element not found');
    }
    
    // Show back button
    updateBackButtonVisibility();
}

// Clear "We are" mode
/**
 * Clears "We are" mode, restoring normal image visibility and resetting inactive flags.
 * Hides the about text overlay and restores all images to full opacity.
 */
function clearWeAreMode() {
    if (!isWeAreMode) return;
    
    // Hide project about text
    hideProjectAboutText();
    
    isWeAreMode = false;
    
    const aboutTextEl = document.getElementById('aboutText');
    if (aboutTextEl) {
        aboutTextEl.style.opacity = '0';
        setTimeout(() => {
            aboutTextEl.style.display = 'none';
        }, 500);
    }
    
    // Hide mobile category content overlay to restore touch navigation
    if (isMobileDevice()) {
        const categoryContent = document.getElementById('mobileCategoryContent');
        if (categoryContent) {
            categoryContent.classList.remove('visible');
            categoryContent.style.pointerEvents = 'none';
            categoryContent.style.visibility = 'hidden';
            categoryContent.style.opacity = '0';
        }
        const contentInner = document.querySelector('.mobile-category-content-inner');
        if (contentInner) {
            contentInner.style.display = 'none';
            contentInner.style.visibility = 'hidden';
            contentInner.style.opacity = '0';
        }
    }
    
    // Restore images opacity and reset inactive flag
    points.forEach(p => {
        p.targetOpacity = 1.0;
        p.isInactive = false; // Reset inactive flag
    });
    
    updateBackButtonVisibility();
}

// Draw points with parallax and emojis
function draw() {
    // Safety check: ensure canvas and ctx are available
    if (!canvas || !ctx) {
        return; // Skip drawing if canvas isn't ready
    }
    
    // IMPORTANT: Don't draw images until all words have appeared
    if (!allWordsVisible) {
        // Only draw black background while words are loading
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }
    
    // Cache mobile detection - only recalculate on resize (performance optimization)
    if (!draw._isMobileCached) {
        draw._isMobileCached = window.innerWidth < 768 || ('ontouchstart' in window);
    }
    const isMobile = draw._isMobileCached;
    
    // Smooth mouse position (optimized - only when not dragging for better performance)
    if (!isDragging) {
    smoothMouseX += (targetMouseX - smoothMouseX) * 0.1;
    smoothMouseY += (targetMouseY - smoothMouseY) * 0.1;
    } else {
        // Direct update while dragging for better responsiveness
        smoothMouseX = targetMouseX;
        smoothMouseY = targetMouseY;
    }

    // If the user hasn't interacted yet, keep everything visible and skip hover-driven fades
    if (!hasUserInteracted) {
        hoveredPoint = null;
        hoverStartTime = 0;
        hoveredConnectedPoints = [];
        hoveredLinesOpacity = 0.0;
        points.forEach(p => {
            p.targetOpacity = 1.0;
            p.isInactive = false;
        });
    }

    // MOBILE ONLY: freeze random grid visuals (no opacity/size animations) on home screen
    const isMobileHome = isMobileVersion &&
        currentMobileCategory === null &&
        alignedEmojiIndex === null &&
        !isFilterMode &&
        !isConnectionMode &&
        !isWeAreMode;
    if (isMobileHome) {
        points.forEach(p => {
            // Keep fully visible and static size
            p.targetOpacity = 1.0;
            p.opacity = 1.0;
            p.targetSize = p.layer === 'layer_1' ? baseEmojiSize : baseEmojiSize * layer2SizeMultiplier;
            p.currentSize = p.targetSize;
            // Clear hover/animation state
            p.isHovered = false;
            p.hoverStartTime = 0;
            p.alignmentStartTime = 0;
        });
        hoveredPoint = null;
        hoveredConnectedPoints = [];
        hoveredLinesOpacity = 0.0;
    }
    
    // zoomFocalPointX/Y is ONLY set in handleWheel() and handleTouchMove() from actual event coordinates
    // Do NOT update it here - this ensures zoom uses the exact mouse position from wheel/touch events
    
    // Calculate center for gyroscope smoothing (used later in parallax calculation)
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Connection mode labels: fade in 0.5s, fade out 0.1s on exit
    const labelsNow = performance.now();
    if (connectionModeLabelsFadeIn && isConnectionMode) {
        connectionModeLabelsOpacity = Math.min(1, (labelsNow - connectionModeLabelsFadeStartTime) / 500);
    } else if (!connectionModeLabelsFadeIn && lastConnectedPointsForLabels.length > 0) {
        connectionModeLabelsOpacity = Math.max(0, 1 - (labelsNow - connectionModeLabelsFadeStartTime) / 100);
        if (connectionModeLabelsOpacity <= 0) lastConnectedPointsForLabels = [];
    }
    
    // Handle selection animation phases (desktop only)
    if (selectionAnimationPhase !== 0 && !isMobile) {
        const now = performance.now();
        const phaseElapsed = now - selectionPhaseStartTime;
        
        if (selectionAnimationPhase === 1) {
            // Phase 1: Zoom in on line image grid + pan to center (1.2 seconds)
            const rawProgress = Math.min(phaseElapsed / SELECTION_PHASE1_DURATION, 1.0);
            const easeProgress = easeOutExpoInertia(rawProgress);
            
            // Animate zoom in directly on the row
            globalZoomLevel = selectionStartZoom + (selectionTargetZoomIn - selectionStartZoom) * easeProgress;
            targetZoomLevel = globalZoomLevel;
            
            // Animate pan to center (row centered)
            cameraPanX = selectionStartPanX + (selectionZoomOutPanX - selectionStartPanX) * easeProgress;
            cameraPanY = selectionStartPanY + (0 - selectionStartPanY) * easeProgress;
            targetCameraPanX = cameraPanX;
            targetCameraPanY = cameraPanY;
            
            // Check if phase 1 is complete
            if (rawProgress >= 1.0) {
                // Move to delay phase
                selectionAnimationPhase = 1.5;
                selectionPhaseStartTime = now;
                globalZoomLevel = selectionTargetZoomIn;
                cameraPanX = selectionZoomOutPanX;
                cameraPanY = 0;
            }
        } else if (selectionAnimationPhase === 1.5) {
            // Delay phase: 0.25 seconds before smooth scroll to clicked image
            globalZoomLevel = selectionTargetZoomIn;
            cameraPanX = selectionZoomOutPanX;
            cameraPanY = 0;
            targetZoomLevel = globalZoomLevel;
            targetCameraPanX = cameraPanX;
            targetCameraPanY = cameraPanY;
            
            // Check if delay is complete
            if (phaseElapsed >= SELECTION_PHASE_DELAY) {
                selectionAnimationPhase = 2;
                selectionPhaseStartTime = now;
                selectionStartZoom = selectionTargetZoomIn;
                selectionStartPanX = selectionZoomOutPanX;
            }
        } else if (selectionAnimationPhase === 2) {
            // Phase 2: Smooth scroll/pan to clicked image (1.2 seconds)
            const rawProgress = Math.min(phaseElapsed / SELECTION_PHASE2_DURATION, 1.0);
            const easePan = easeOutCubic(rawProgress); // smooth pan to clicked image
            
            // Zoom stays at selectionTargetZoomIn (already there from phase 1)
            globalZoomLevel = selectionTargetZoomIn;
            targetZoomLevel = globalZoomLevel;
            
            // Animate pan from center to clicked image
            cameraPanX = selectionStartPanX + (selectionFinalPanX - selectionStartPanX) * easePan;
            targetCameraPanX = cameraPanX;
            
            // Check if phase 2 is complete
            if (rawProgress >= 1.0) {
                selectionAnimationPhase = 0;
                carouselAutoScrollPaused = false; // Carousel starts when animation completes
                globalZoomLevel = selectionTargetZoomIn;
                cameraPanX = selectionFinalPanX;
                targetZoomLevel = globalZoomLevel;
                targetCameraPanX = cameraPanX;
            }
        } else if (selectionAnimationPhase === -1) {
            // Reverse Phase 1: Zoom out (20% closer than full grid) + images start moving back (1.2 seconds)
            const rawProgress = Math.min(phaseElapsed / SELECTION_PHASE1_DURATION, 1.0);
            const easeProgress = easeOutExpoInertia(rawProgress);
            
            // Animate zoom out to selectionZoomOutExit (20% closer than selectionTargetZoomOut)
            globalZoomLevel = selectionStartZoom + (selectionZoomOutExit - selectionStartZoom) * easeProgress;
            targetZoomLevel = globalZoomLevel;
            
            // Animate pan to center
            cameraPanX = selectionStartPanX + (selectionZoomOutPanX - selectionStartPanX) * easeProgress;
            cameraPanY = selectionStartPanY + (0 - selectionStartPanY) * easeProgress;
            targetCameraPanX = cameraPanX;
            targetCameraPanY = cameraPanY;
            
            // Check if reverse phase 1 is complete
            if (rawProgress >= 1.0) {
                selectionAnimationPhase = -2;
                selectionPhaseStartTime = now;
                globalZoomLevel = selectionZoomOutExit;
                cameraPanX = selectionZoomOutPanX;
                cameraPanY = 0;
            }
        } else if (selectionAnimationPhase === -2) {
            // Reverse Phase 2: Zoom to 1.0 from selectionZoomOutExit (1.2 seconds)
            const rawProgress = Math.min(phaseElapsed / SELECTION_PHASE2_DURATION, 1.0);
            const easeProgress = easeOutExpoInertia(rawProgress);
            
            // Animate zoom from exit zoom level to 1.0
            globalZoomLevel = selectionZoomOutExit + (1.0 - selectionZoomOutExit) * easeProgress;
            targetZoomLevel = globalZoomLevel;
            
            // Animate pan from zoomed-out center to 0,0
            cameraPanX = selectionZoomOutPanX + (0 - selectionZoomOutPanX) * easeProgress;
            cameraPanY = 0;
            targetCameraPanX = cameraPanX;
            targetCameraPanY = cameraPanY;
            
            // Check if reverse animation is complete
            if (rawProgress >= 1.0) {
                selectionAnimationPhase = 0;
                carouselAutoScrollPaused = false; // Reset for next entry
                globalZoomLevel = 1.0;
                cameraPanX = 0;
                cameraPanY = 0;
                targetZoomLevel = 1.0;
                targetCameraPanX = 0;
                targetCameraPanY = 0;
            }
        }
    }
    
    
    // Smooth gyroscope data for parallax (mobile only)
    // Only smooth when device orientation is supported
    if (isMobile && deviceOrientationSupported) {
        // Smooth interpolation for gyroscope data (prevents jittery movement)
        // Gamma (left/right tilt) maps to X offset, Beta (forward/back tilt) maps to Y offset
        // When device tilts right (positive gamma), content should shift right (positive offset)
        // When device tilts forward (positive beta), content should shift down (positive offset)
        const targetGyroX = currentGamma * centerX; // Offset from center based on tilt
        const targetGyroY = currentBeta * centerY; // Offset from center based on tilt
        
        smoothGyroX += (targetGyroX - smoothGyroX) * gyroSmoothness;
        smoothGyroY += (targetGyroY - smoothGyroY) * gyroSmoothness;
    } else {
        // Reset gyroscope offsets when not in use
        smoothGyroX = 0;
        smoothGyroY = 0;
    }
    
    // Smooth camera zoom interpolation
    if (isZoomTransitioning) {
        // Discrete zoom transition (for non-selection mode)
        const elapsed = performance.now() - zoomTransitionStartTime;
        const progress = Math.min(elapsed / zoomTransitionDuration, 1.0);
        
        // Ease in-out for smooth transition
        const easeProgress = progress < 0.5 
            ? 2 * progress * progress 
            : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        
        globalZoomLevel = zoomTransitionStartLevel + (zoomTransitionTargetLevel - zoomTransitionStartLevel) * easeProgress;
        
        if (progress >= 1.0) {
            isZoomTransitioning = false;
            globalZoomLevel = zoomTransitionTargetLevel;
        }
    } else if (alignedEmojiIndex !== null || isFilterMode || useContinuousZoom || !isZoomTransitioning) {
        // Smooth gradual zoom interpolation (selection/filter mode, touch pinch zoom, and normal mode with mouse wheel)
        // Normal mode: when isZoomTransitioning is false, it means we're using smooth zoom from wheel events
        
        // Apply smooth zoom inertia (continue zooming even after wheel stops)
        if (Math.abs(zoomVelocity) > 0.0001) {
            const isMobile = isMobileDevice();
            const inertiaDecay = isMobile ? 0.96 : 0.96; // Same decay for both
            // Mobile: reduce zoom speed by 3x (0.25 / 3 = 0.083)
            const zoomMultiplier = isMobile ? 0.083 : 0.25;
            const newTargetZoom = targetZoomLevel * (1.0 + zoomVelocity * zoomMultiplier);
            
            // Limit max zoom out to random image grid size (mobile only)
            let clampedZoom;
            if (isMobile) {
                const box = getBoundingBox();
                const gridWidth = box.width;
                const gridHeight = box.height;
                const maxZoomOut = Math.min(canvas.width / gridWidth, canvas.height / gridHeight);
                clampedZoom = Math.max(maxZoomOut, Math.min(maxZoom, newTargetZoom));
            } else {
                clampedZoom = Math.max(minZoom, Math.min(maxZoom, newTargetZoom));
            }
            
            if (Math.abs(clampedZoom - targetZoomLevel) > 0.0001) {
                // Recalculate pan for new zoom to keep focal point fixed
                const focalX = (zoomFocalPointX !== null && zoomFocalPointX !== undefined) ? zoomFocalPointX : smoothMouseX;
                const focalY = (zoomFocalPointY !== null && zoomFocalPointY !== undefined) ? zoomFocalPointY : smoothMouseY;
                
        const worldX = ((focalX - centerX - cameraPanX) / globalZoomLevel) + centerX;
        const worldY = ((focalY - centerY - cameraPanY) / globalZoomLevel) + centerY;
        
                targetZoomLevel = clampedZoom;
                targetCameraPanX = focalX - centerX - (worldX - centerX) * clampedZoom;
                targetCameraPanY = focalY - centerY - (worldY - centerY) * clampedZoom;
            } else {
                // Hit limit, reset velocity
                zoomVelocity = 0;
            }
            
            // Decay velocity (light inertia)
            zoomVelocity *= inertiaDecay;
        }
        
        // Mobile: reduce zoom interpolation speed by 3x
        const isMobile = isMobileDevice();
        const zoomSmoothness = isMobile ? 0.013 : 0.04; // 3x slower for mobile (0.04 / 3 ≈ 0.013)
        globalZoomLevel += (targetZoomLevel - globalZoomLevel) * zoomSmoothness;
        
        // Smoothly interpolate camera pan to keep zoom focal point fixed
        // targetCameraPanX/Y is set in handleWheel() and handleTouchMove() based on zoomFocalPointX/Y
        // We just interpolate cameraPanX/Y towards targetCameraPanX/Y to match the zoom interpolation
        // Do NOT recalculate targetCameraPanX/Y here - it's already correct from handleWheel/handleTouchMove
        cameraPanX += (targetCameraPanX - cameraPanX) * zoomSmoothness;
        cameraPanY += (targetCameraPanY - cameraPanY) * zoomSmoothness;
    } else {
        // Default: use discrete zoom level (only when isZoomTransitioning is true, which happens from startZoomTransition)
        globalZoomLevel = zoomLevels[currentZoomIndex];
        targetZoomLevel = globalZoomLevel;
    }
    
    // Mobile vertical scroll (mobile only, zero inertia - position follows finger exactly)
    if (isMobile && alignedEmojiIndex !== null) {
        mobileScrollVelocity = 0;
        mobileScrollPosition = targetMobileScrollPosition;
        
        // Calculate scroll offset and apply to camera pan Y
        // Use layout-derived content height; compute max scroll in world units, then convert to screen px.
        const viewHeightWorld = canvas.height / Math.max(0.0001, globalZoomLevel);
        const maxScrollWorld = Math.max(0, mobileAlignedContentHeightWorld - viewHeightWorld);
        const scrollOffsetWorld = mobileScrollPosition * maxScrollWorld;
        const scrollOffsetScreen = scrollOffsetWorld * globalZoomLevel;

        // Apply scroll offset relative to the baseline pan at scroll position 0 (no smoothing = zero inertia)
        targetCameraPanY = mobileAlignedBasePanY - scrollOffsetScreen;
        cameraPanY = targetCameraPanY;
        
        // Update scroll indicator visibility
        if (performance.now() > scrollIndicatorFadeTime && !isMobileScrolling) {
            scrollIndicatorVisible = false;
        }
    } else {
        scrollIndicatorVisible = false;
        
        // Smooth camera pan interpolation with inertia (desktop only when not in mobile aligned mode)
        // Skip when selection animation is running (phase drives camera directly; avoids jitter at phase 0/2 boundaries)
        const phaseDrivingCamera = selectionAnimationPhase !== 0;
        if (!isDragging && !phaseDrivingCamera) {
            const inSelectionMode = (alignedEmojiIndex !== null || isConnectionMode) && !isMobileDevice();
            const smooth = inSelectionMode ? SELECTION_PAN_SMOOTHNESS : panSmoothness;
            const decay = inSelectionMode ? SELECTION_PAN_INERTIA_DECAY : 0.94;

            // Selection mode carousel: auto-scroll left-to-right 60px/sec (web only)
            if (alignedEmojiIndex !== null && selectionAnimationPhase === 0 && !isMobileDevice() && !carouselAutoScrollPaused) {
                const now = performance.now();
                const dt = lastDrawTimeForCarousel > 0 ? (now - lastDrawTimeForCarousel) / 1000 : 1/60;
                lastDrawTimeForCarousel = now;
                targetCameraPanX -= CAROUSEL_AUTO_SCROLL_SPEED * dt;
            } else if (selectionAnimationPhase !== 0 || alignedEmojiIndex === null || isMobileDevice()) {
                lastDrawTimeForCarousel = 0;
            }

            // Apply light velocity-based inertia when not dragging (only if there's significant velocity)
            if (Math.abs(panVelocityX) > 0.1 || Math.abs(panVelocityY) > 0.1) {
                const inertiaStrength = inSelectionMode ? 1.2 : 2; // Gentler inertia in selection mode
                targetCameraPanX += panVelocityX * inertiaStrength;
                targetCameraPanY += panVelocityY * inertiaStrength;
                // Decay velocity over time (slower decay for longer, smoother inertia)
                panVelocityX *= decay;
                panVelocityY *= decay;
            }
            
            // Smooth interpolation towards target (only when not dragging)
            cameraPanX += (targetCameraPanX - cameraPanX) * smooth;
            cameraPanY += (targetCameraPanY - cameraPanY) * smooth;
            
            // Infinite carousel: wrap pan in selection mode so right of last image shows first (only when not animating)
            if (alignedEmojiIndex !== null && alignedRowTotalWidthWorld > 0 && !isMobileDevice()) {
                const totalWidthScreen = alignedRowTotalWidthWorld * globalZoomLevel;
                let delta = cameraPanX - selectionBasePanX;
                if (delta > totalWidthScreen * 0.5) {
                    cameraPanX -= totalWidthScreen;
                    targetCameraPanX -= totalWidthScreen;
                } else if (delta < -totalWidthScreen * 0.5) {
                    cameraPanX += totalWidthScreen;
                    targetCameraPanX += totalWidthScreen;
                }
            }
        }
    }
    
    // Clear canvas with black background
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw static background grid in SCREEN space (not affected by zoom/pan)
    const gridPattern = getGridPattern();
    if (gridPattern) {
        ctx.save();
        // Ensure identity transform so pattern doesn't inherit camera transform
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = gridPattern;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
    }
    
    
    // Apply camera zoom and pan transform
    // (centerX and centerY already calculated above for gyroscope smoothing)
    ctx.save();
    ctx.translate(centerX + cameraPanX, centerY + cameraPanY);
    ctx.scale(globalZoomLevel, globalZoomLevel);
    ctx.translate(-centerX, -centerY);
    ctx.globalAlpha = 1.0; // Reset alpha for drawing within transform (will be set per-point)
    
    // Calculate center offset for parallax
    // On mobile: combine touch position with gyroscope data for accurate parallax
    // On desktop: use only mouse position
    let offsetX, offsetY;
    
    if (isMobile && deviceOrientationSupported) {
        // Mobile with gyroscope: combine touch and gyroscope
        const touchOffsetX = (smoothMouseX - centerX) * parallaxStrength * 0.3; // Reduce touch influence on mobile
        const touchOffsetY = (smoothMouseY - centerY) * parallaxStrength * 0.3;
        // smoothGyroX/Y are already offsets from center, apply parallax strength
        const gyroOffsetX = smoothGyroX * gyroParallaxStrength;
        const gyroOffsetY = smoothGyroY * gyroParallaxStrength;
        
        // Combine touch and gyroscope (gyroscope has more influence on mobile)
        offsetX = touchOffsetX + gyroOffsetX;
        offsetY = touchOffsetY + gyroOffsetY;
    } else {
        // Desktop or mobile without gyroscope: use only mouse/touch position
        offsetX = (smoothMouseX - centerX) * parallaxStrength;
        offsetY = (smoothMouseY - centerY) * parallaxStrength;
    }
    
    // Cache mouse coordinates for hover detection (calculated once per frame)
    const scaledMouseXForHover = ((smoothMouseX - centerX - cameraPanX) / globalZoomLevel) + centerX;
    const scaledMouseYForHover = ((smoothMouseY - centerY - cameraPanY) / globalZoomLevel) + centerY;
    const currentTime = performance.now(); // Cache current time to avoid repeated calls
    
    // Sort points by opacity before drawing: non-selected (low opacity) first, then selected (high opacity)
    // This ensures selected images always appear on top
    // IMPORTANT: For mobile selection mode, ensure random grid (non-aligned) is drawn first, then aligned images
    const sortedPoints = [...points].sort((a, b) => {
        // Check if points are aligned (in selection mode)
        const aIsAligned = a.isAligned || (alignedEmojiIndex !== null && alignedEmojis.some(aligned => aligned.imagePath === a.imagePath));
        const bIsAligned = b.isAligned || (alignedEmojiIndex !== null && alignedEmojis.some(aligned => aligned.imagePath === b.imagePath));
        
        // If one is aligned and other is not, draw non-aligned first (random grid behind)
        if (!aIsAligned && bIsAligned) return -1;
        if (aIsAligned && !bIsAligned) return 1;
        
        // If both have opacity 0, maintain order
        if (a.opacity < 0.01 && b.opacity < 0.01) return 0;
        
        // If one has opacity 0 and other doesn't, put opacity 0 first
        if (a.opacity < 0.01 && b.opacity >= 0.01) return -1;
        if (a.opacity >= 0.01 && b.opacity < 0.01) return 1;
        
        // Otherwise sort by opacity (low to high) so high opacity images are drawn last (on top)
        return a.opacity - b.opacity;
    });
    
    // Draw all points in sorted order (non-selected first, selected on top)
    sortedPoints.forEach(point => {
        const speed = point.layer === 'layer_1' ? layer1Speed : layer2Speed;
        
        // Animate opacity (optimized: skip if already at target)
        // For selection mode fade out: use fast fade (250ms) for non-aligned images
        // For mobile version: use 300ms fade out for random grid
        // Use faster fade in when restoring opacity (when mouse leaves)
        let currentOpacitySpeed;
        if (point.targetOpacity === 0.0 && point.isInactive) {
            if (isMobileVersion && currentMobileCategory && !point.isAligned && !point.isFiltered) {
                // Mobile grid fade out: 300ms duration
                currentOpacitySpeed = MOBILE_GRID_FADE_OUT_SPEED;
            } else if (isIndexMode && selectedIndexFolder === null) {
                // Index mode fade out: 2 seconds duration
                currentOpacitySpeed = INDEX_MODE_FADE_SPEED;
            } else if (alignedEmojiIndex !== null) {
                // Fast fade out for selection mode: 250ms duration
                currentOpacitySpeed = FADE_OUT_SPEED;
            } else {
                currentOpacitySpeed = opacitySmoothness;
            }
        } else {
            currentOpacitySpeed = (point.targetOpacity > point.opacity && point.opacity < 0.5) ? HOVER_FADE_IN_SPEED : opacitySmoothness;
        }
        if (Math.abs(point.opacity - point.targetOpacity) > 0.001) {
            point.opacity += (point.targetOpacity - point.opacity) * currentOpacitySpeed;
        } else {
            point.opacity = point.targetOpacity;
        }
        
        // Mobile: in selection mode or with category menu open, never draw non-aligned grid (fixes first-time grid staying visible)
        if (isMobileVersion && !point.isAligned && !point.isFiltered) {
            if (alignedEmojiIndex !== null) {
                point.opacity = 0;
                point.targetOpacity = 0;
                return;
            }
            if (currentMobileCategory !== null && !isWeAreMode) {
                point.opacity = 0;
                point.targetOpacity = 0;
                return;
            }
        }
        // Skip drawing if opacity effectively 0 (for random grid fade out)
        if (point.opacity < 0.01 && !point.isAligned && !point.isFiltered) {
            if (isMobileVersion && alignedEmojiIndex === null && !isFilterMode && !isConnectionMode && currentMobileCategory === null && !isWeAreMode) {
                point.opacity = 1.0;
                point.targetOpacity = 1.0;
            } else {
                return;
            }
        }
        
        let x, y;
        let imageSize;
        
        if (point.isAligned || point.isFiltered || (point.alignmentStartTime > 0 && !point.isAligned && !point.isFiltered)) {
            // Time-based smooth animation with logarithmic easing (1.2 seconds duration)
            const elapsed = currentTime - point.alignmentStartTime; // Use cached time
            const progress = Math.min(elapsed / alignmentAnimationDuration, 1.0);
            
            // Use logarithmic easing for smooth, natural-feeling animations
            const easeProgress = easeOutLog(progress);
            
            // Interpolate position and size
            point.currentAlignedX = point.startX + (point.targetX - point.startX) * easeProgress;
            point.currentAlignedY = point.startY + (point.targetY - point.startY) * easeProgress;
            point.currentSize = point.startSize + (point.targetSize - point.startSize) * easeProgress;
            
            // If aligned or filtered, use target position; otherwise transitioning back
            if (point.isAligned || point.isFiltered) {
                x = point.currentAlignedX;
                y = point.currentAlignedY;
                imageSize = point.currentSize;
            } else {
                // Transitioning back to original - combine with parallax
                x = point.currentAlignedX + (offsetX * speed);
                y = point.currentAlignedY + (offsetY * speed);
                imageSize = point.currentSize;
                // Reset animation start time when transition completes
                if (progress >= 1.0) {
                    point.alignmentStartTime = 0;
                    point.currentAlignedX = point.originalBaseX;
                    point.currentAlignedY = point.originalBaseY;
                    point.isFiltered = false;
                }
            }
        } else {
            // Normal state - use original position with parallax
            x = point.originalBaseX + (offsetX * speed);
            y = point.originalBaseY + (offsetY * speed);
            
            // Smoothly animate size change
            point.currentSize += (point.targetSize - point.currentSize) * 0.1;
            
            // Check if hovered (using cached coordinates)
            // Only allow hover if user has interacted AND mouse is actually over the canvas AND not in index mode
            const allowHoverLogic = hasUserInteracted && mouseOverCanvas && !isIndexMode;
            const isHovered = allowHoverLogic && isPointHovered(x, y, scaledMouseXForHover, scaledMouseYForHover, point.currentSize / 2);
            
            // Track hover state for timeout (fade unrelated images after 1 second, 2x faster)
            if (allowHoverLogic) {
                if (isHovered && hoveredPoint !== point) {
                    // New point is being hovered
                    hoveredPoint = point;
                    hoverStartTime = currentTime;
                    // Reset hovered lines
                    hoveredConnectedPoints = [];
                    hoveredLinesOpacity = 0.0;
                } else if (!isHovered && hoveredPoint === point) {
                    // Stopped hovering this point
                    hoveredPoint = null;
                    hoverStartTime = 0;
                    
                    // If connection mode was auto-entered (not clicked), exit it when mouse moves away
                    if (isConnectionMode && !isConnectionModeClicked) {
                        exitConnectionMode();
                    }
                    
                    // Restore opacity for all images ONLY if not in selection/filter/connection mode
                    // In selection/filter/connection mode, opacity should remain as set by selection
                    if (alignedEmojiIndex === null && !isFilterMode && !isConnectionMode) {
                        points.forEach(p => {
                            p.targetOpacity = 1.0;
                        });
                    }
                    // Start fade out hovered lines (will be animated smoothly in draw loop)
                    // hoveredLinesOpacity will fade to 0.0 in draw loop
                } else if (isHovered && hoveredPoint === point) {
                    // Still hovering - set connection points from precomputed (use current point refs so positions are correct)
                    const hoveredFolder = getPointFolder(point);
                    const precomputed = precomputedConnectionTrajectories.get(hoveredFolder);
                    if (precomputed && precomputed.points.length > 1) {
                        const currentRefs = precomputed.points.map(p => points.find(cur => cur.imagePath === p.imagePath)).filter(Boolean);
                        currentRefs.sort((a, b) => a.originalBaseX - b.originalBaseX);
                        hoveredConnectedPoints = currentRefs.length > 1 ? currentRefs : points.filter(p => getPointFolder(p) === hoveredFolder).sort((a, b) => a.originalBaseX - b.originalBaseX);
                    } else {
                        hoveredConnectedPoints = points.filter(p => getPointFolder(p) === hoveredFolder);
                        hoveredConnectedPoints.sort((a, b) => a.originalBaseX - b.originalBaseX);
                    }
                    // Don't apply fade/connection-mode logic if already in selection/filter/connection mode
                    if (alignedEmojiIndex === null && !isFilterMode && !isConnectionMode) {
                        const hoverDuration = currentTime - hoverStartTime;
                        const hoverTimeout = (typeof isMobileDevice === 'function' && isMobileDevice()) ? HOVER_FADE_TIMEOUT : HOVER_FADE_TIMEOUT_WEB;
                        if (hoverDuration >= hoverTimeout) {
                            enterConnectionMode(point, false);
                            points.forEach(p => {
                                p.targetOpacity = getPointFolder(p) === hoveredFolder ? 1.0 : 0.0;
                            });
                            hoveredLinesOpacity = 1.0;
                        } else {
                            const fadeProgress = Math.min(hoverDuration / hoverTimeout, 1.0);
                            const isMobile = window.innerWidth < 768 || ('ontouchstart' in window);
                            const fadeSpeed = isMobile ? HOVER_FADE_IN_SPEED : HOVER_FADE_IN_SPEED_WEB;
                            hoveredLinesOpacity += (fadeProgress - hoveredLinesOpacity) * fadeSpeed;
                        }
                    }
                }
            } else {
                // No interaction yet: keep hover state cleared
                point.isHovered = false;
                point.hoverStartTime = 0;
            }
            
            // Smooth hover zoom transition (0.5 seconds)
            if (isHovered !== point.isHovered) {
                // Hover state changed - start transition
                point.isHovered = isHovered;
                point.hoverStartTime = currentTime;
            }
            
            if (point.hoverStartTime > 0) {
                const elapsed = currentTime - point.hoverStartTime; // Use cached time
                const progress = Math.min(elapsed / hoverZoomTransitionDuration, 1.0);
                
                if (progress >= 1.0) {
                    // Transition complete
                    point.hoverSize = point.isHovered ? hoverZoom : 1.0;
                    point.hoverStartTime = 0; // Reset to avoid future calculations
                } else {
                    // Smooth ease-out easing
                    const easeProgress = 1 - Math.pow(1 - progress, 3);
                    
                    if (point.isHovered) {
                        // Zooming in
                        point.hoverSize = 1.0 + (hoverZoom - 1.0) * easeProgress;
                    } else {
                        // Zooming out
                        point.hoverSize = hoverZoom + (1.0 - hoverZoom) * easeProgress;
                    }
                }
            } else {
                // Initial state - only set if changed
                const targetHoverSize = point.isHovered ? hoverZoom : 1.0;
                if (Math.abs(point.hoverSize - targetHoverSize) > 0.001) {
                    point.hoverSize = targetHoverSize;
                }
            }
            
            imageSize = point.currentSize * point.hoverSize;
        }
        
        // Get image from cache (prefer full-res in selection, else thumbnail for grid)
        const imageData = imageCache[point.imagePath];
        const img = imageData ? (imageData.img || imageData.thumb) : null;
        
        // PERFORMANCE: Use globalAlpha directly (more efficient than save/restore)
        // Only change globalAlpha if it's different (optimization)
        if (Math.abs(ctx.globalAlpha - point.opacity) > 0.01) {
            ctx.globalAlpha = point.opacity;
        }
        
        // Don't draw if opacity is 0 (completely invisible)
        if (point.opacity <= 0.001) {
            // Skip drawing this image completely
            return;
        }
        
        // Draw image if loaded, otherwise skip
        if (img && imageData && !imageData.error) {
            // Calculate dimensions maintaining aspect ratio (using helper function)
            const dims = calculateImageDrawDimensions(point, imageData, imageSize);
            const drawWidth = dims.width;
            const drawHeight = dims.height;
            
            const halfWidth = drawWidth / 2;
            const halfHeight = drawHeight / 2;
            
            // Infinite carousel: draw aligned images in three positions (left copy, main, right copy)
            const drawOffsets = (point.isAligned && !isMobileDevice() && alignedRowTotalWidthWorld > 0)
                ? [0, alignedRowTotalWidthWorld, -alignedRowTotalWidthWorld]
                : [0];
            
            try {
                for (let i = 0; i < drawOffsets.length; i++) {
                    const drawX = x + drawOffsets[i];
                    ctx.drawImage(img, drawX - halfWidth, y - halfHeight, drawWidth, drawHeight);
                }
            } catch (e) {
                // If drawImage fails, skip drawing
                // Don't draw placeholder to avoid grey rectangles
            }
            // image_names: small white label above image (name without extension), fade in 0.5s / fade out 0.1s
            const showLabel = IMAGE_NAMES_ENABLED && connectionModeLabelsOpacity > 0.01 && (isConnectionMode ? connectedPoints.includes(point) : lastConnectedPointsForLabels.includes(point));
            if (showLabel) {
                const name = point.imagePath.split('/').pop().replace(/\.[^.]+$/, '') || 'image';
                const prevAlpha = ctx.globalAlpha;
                ctx.globalAlpha = connectionModeLabelsOpacity * point.opacity;
                ctx.font = '14px Arial';
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(name, x, y - halfHeight - 6);
                ctx.globalAlpha = prevAlpha;
            }
        }
    });
    
    // Auto-hover connection mode exit check: if mouse is not over any connected point, exit
    if (isConnectionMode && !isConnectionModeClicked && autoHoverTriggerPoint !== null) {
        // Check if mouse is over ANY connected point
        let mouseOverConnectedPoint = false;
        for (const cp of connectedPoints) {
            const cpX = cp.originalBaseX + (offsetX * (cp.layer === 'layer_1' ? 1.0 : 0.5));
            const cpY = cp.originalBaseY + (offsetY * (cp.layer === 'layer_1' ? 1.0 : 0.5));
            if (isPointHovered(cpX, cpY, scaledMouseXForHover, scaledMouseYForHover, cp.currentSize / 2)) {
                mouseOverConnectedPoint = true;
                break;
            }
        }
        
        // If mouse is not over any connected point, exit auto-hover connection mode
        if (!mouseOverConnectedPoint) {
            exitConnectionMode();
            // Also clear hover state
            hoveredPoint = null;
            hoverStartTime = 0;
            hoveredConnectedPoints = [];
            hoveredLinesOpacity = 0.0;
            // Restore opacity for all images
            points.forEach(p => {
                p.targetOpacity = 1.0;
            });
        }
    }
    
    // Animate hovered lines opacity fade out when mouse leaves
    if (hoveredLinesOpacity > 0.001 && hoveredPoint === null) {
        // Use faster fade speed for web (2x faster), slower for mobile
        const isMobile = window.innerWidth < 768 || ('ontouchstart' in window);
        const fadeSpeed = isMobile ? HOVER_FADE_IN_SPEED : HOVER_FADE_IN_SPEED_WEB;
        hoveredLinesOpacity += (0.0 - hoveredLinesOpacity) * fadeSpeed;
        if (hoveredLinesOpacity <= 0.001) {
            hoveredLinesOpacity = 0.0;
            hoveredConnectedPoints = [];
        }
    }
    
    // Restore transform and reset globalAlpha after drawing
    ctx.restore();
    ctx.globalAlpha = 1.0;
    
    // Background mobile auto-lines (non-interactive)
    updateMobileAutoLines(currentTime);
    drawMobileAutoLines(ctx, currentTime);
    
    // Draw connection lines (dotted curvy lines with arrows) on hover
    if (hoveredConnectedPoints.length > 1 && hoveredLinesOpacity > 0.001) {
        ctx.save();
        ctx.translate(centerX + cameraPanX, centerY + cameraPanY);
        ctx.scale(globalZoomLevel, globalZoomLevel);
        ctx.translate(-centerX, -centerY);
        
        // Apply opacity for hover lines
        ctx.globalAlpha = hoveredLinesOpacity;
        
        // Draw lines connecting consecutive images
        for (let i = 0; i < hoveredConnectedPoints.length - 1; i++) {
            const point1 = hoveredConnectedPoints[i];
            const point2 = hoveredConnectedPoints[i + 1];
            
            // Get image dimensions
            const imageData1 = imageCache[point1.imagePath];
            const imageData2 = imageCache[point2.imagePath];
            
            if (!imageData1 || !imageData2) continue;
            
            // Use helper function to calculate dimensions (performance optimization)
            const dims1 = calculateConnectionLineImageSize(point1, imageData1);
            const dims2 = calculateConnectionLineImageSize(point2, imageData2);
            
            // Use positions WITHOUT parallax to avoid wobble animation
            drawCurvedConnectionLine(ctx, point1.originalBaseX, point1.originalBaseY, point2.originalBaseX, point2.originalBaseY, dims1.width, dims1.height, dims2.width, dims2.height);
        }
        
        ctx.restore();
    }
    
    // Draw connection lines (dotted curvy lines with arrows) in connection mode
    if (isConnectionMode && connectedPoints.length > 1) {
                ctx.save();
        ctx.translate(centerX + cameraPanX, centerY + cameraPanY);
        ctx.scale(globalZoomLevel, globalZoomLevel);
        ctx.translate(-centerX, -centerY);
        
        // Draw lines connecting consecutive images
        for (let i = 0; i < connectedPoints.length - 1; i++) {
            const point1 = connectedPoints[i];
            const point2 = connectedPoints[i + 1];
            
            // Get image dimensions
            const imageData1 = imageCache[point1.imagePath];
            const imageData2 = imageCache[point2.imagePath];
            
            if (!imageData1 || !imageData2) continue;
            
            // Use helper function to calculate dimensions (performance optimization)
            const dims1 = calculateConnectionLineImageSize(point1, imageData1);
            const dims2 = calculateConnectionLineImageSize(point2, imageData2);
            
            // Use positions WITHOUT parallax to avoid wobble animation
            drawCurvedConnectionLine(ctx, point1.originalBaseX, point1.originalBaseY, point2.originalBaseX, point2.originalBaseY, dims1.width, dims1.height, dims2.width, dims2.height);
        }
                
                ctx.restore();
    }
    
    // Draw mobile scroll indicator (Apple-style, minimalistic, on the left)
    if (isMobile && alignedEmojiIndex !== null && scrollIndicatorVisible) {
        const indicatorWidth = 2.5; // Thin line
        const indicatorPadding = 8; // Padding from left edge
        const indicatorHeight = 60; // Height of the scroll indicator
        const indicatorMinY = 50; // Minimum Y position (top padding)
        const indicatorMaxY = canvas.height - 50 - indicatorHeight; // Maximum Y position
        
        // Calculate indicator position based on scroll position
        const indicatorY = indicatorMinY + (mobileScrollPosition * (indicatorMaxY - indicatorMinY));
        
        // Draw scroll indicator with fade effect (Apple-style: rounded corners, subtle)
        const fadeOpacity = Math.min(1.0, (scrollIndicatorFadeTime - performance.now()) / 1000);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.4 * fadeOpacity})`; // Semi-transparent white, subtle
        
        // Draw rounded rectangle (Apple-style minimalistic) - simple rounded rect
        const radius = 1.25;
        ctx.beginPath();
        ctx.moveTo(indicatorPadding + radius, indicatorY);
        ctx.lineTo(indicatorPadding + indicatorWidth - radius, indicatorY);
        ctx.quadraticCurveTo(indicatorPadding + indicatorWidth, indicatorY, indicatorPadding + indicatorWidth, indicatorY + radius);
        ctx.lineTo(indicatorPadding + indicatorWidth, indicatorY + indicatorHeight - radius);
        ctx.quadraticCurveTo(indicatorPadding + indicatorWidth, indicatorY + indicatorHeight, indicatorPadding + indicatorWidth - radius, indicatorY + indicatorHeight);
        ctx.lineTo(indicatorPadding + radius, indicatorY + indicatorHeight);
        ctx.quadraticCurveTo(indicatorPadding, indicatorY + indicatorHeight, indicatorPadding, indicatorY + indicatorHeight - radius);
        ctx.lineTo(indicatorPadding, indicatorY + radius);
        ctx.quadraticCurveTo(indicatorPadding, indicatorY, indicatorPadding + radius, indicatorY);
        ctx.closePath();
        ctx.fill();
    }

    // Mobile: position more/extra block after first image (scrolls with content)
    if (isMobileDevice() && alignedEmojiIndex !== null && mobileMoreBlockCenterYWorld > 0) {
        const moreEl = document.getElementById('projectMore');
        if (moreEl && moreEl.textContent.trim()) {
            const centerY = canvas.height / 2;
            const screenY = (mobileMoreBlockCenterYWorld - centerY) * globalZoomLevel + centerY + cameraPanY;
            const top = screenY - (mobileMoreBlockHeightWorld * globalZoomLevel) / 2;
            moreEl.style.position = 'fixed';
            moreEl.style.left = mobileMoreBlockMarginScreen + 'px';
            moreEl.style.width = mobileMoreBlockWidthScreen + 'px';
            moreEl.style.top = Math.round(top) + 'px';
            moreEl.style.fontSize = '14px';
            moreEl.style.fontFamily = "'Grammatika Demo', Arial, sans-serif";
            moreEl.style.color = '#fff';
            moreEl.style.textAlign = 'left';
            moreEl.style.visibility = 'visible';
            moreEl.style.display = 'block';
            moreEl.style.whiteSpace = 'pre-wrap';
            moreEl.style.wordBreak = 'break-word';
            moreEl.style.lineHeight = '1.6';
        }
    }

    // Mobile: position about block above first image (scrolls with content, same approach as more.txt)
    if (isMobileDevice() && alignedEmojiIndex !== null && mobileAboutBlockCenterYWorld > 0) {
        const aboutEl = document.getElementById('projectAboutText');
        if (aboutEl && aboutEl.style.display !== 'none') {
            const centerY = canvas.height / 2;
            const screenY = (mobileAboutBlockCenterYWorld - centerY) * globalZoomLevel + centerY + cameraPanY;
            const top = screenY - (mobileAboutBlockHeightWorld * globalZoomLevel) / 2;
            aboutEl.style.position = 'fixed';
            aboutEl.style.left = mobileAboutBlockMarginScreen + 'px';
            aboutEl.style.width = mobileAboutBlockWidthScreen + 'px';
            aboutEl.style.top = Math.round(top) + 'px';
            aboutEl.style.transform = 'none';
            aboutEl.style.bottom = 'auto';
            aboutEl.style.right = 'auto';
            aboutEl.style.visibility = 'visible';
            aboutEl.style.display = 'block';
        }
    }
}

// Animation loop (pauses when tab hidden to save CPU/battery)
function animate() {
    if (!document.hidden) {
    draw();
    }
    requestAnimationFrame(animate);
}

// Back button functionality - cache DOM element for performance
let cachedBackButton = null;
function updateBackButtonVisibility() {
    if (!cachedBackButton) {
        cachedBackButton = document.getElementById('backButton');
        if (!cachedBackButton) return;
    }
    
    // Show back button when images are aligned, filtered, in connection mode, in "We are" mode, in index mode, or when mobile category content is open
    if (alignedEmojiIndex !== null || isFilterMode || isWeAreMode || isConnectionMode || isIndexMode || (isMobileVersion && currentMobileCategory !== null)) {
        cachedBackButton.style.display = 'flex';
        cachedBackButton.style.visibility = 'visible';
        cachedBackButton.style.opacity = '1';
        // Force position for mobile - ensure it's at bottom right
        if (isMobileDevice()) {
            cachedBackButton.style.top = 'auto';
            cachedBackButton.style.bottom = '20px';
            cachedBackButton.style.right = '20px';
            cachedBackButton.style.left = 'auto';
            cachedBackButton.style.zIndex = '10000';
        }
    } else {
        cachedBackButton.style.display = 'none';
    }
}

// Handle device orientation for gyroscope parallax (mobile only)
function handleDeviceOrientation(e) {
    // Only use on mobile devices
    if (!isMobileDevice()) return;
    
    // Check if device orientation is supported
    if (typeof e.beta === 'undefined' || typeof e.gamma === 'undefined') {
        deviceOrientationSupported = false;
        return;
    }
    
    deviceOrientationSupported = true;
    
    // Calibrate on first reading (set initial orientation as "center")
    if (initialBeta === null || initialGamma === null) {
        initialBeta = e.beta || 0;
        initialGamma = e.gamma || 0;
        currentBeta = 0;
        currentGamma = 0;
        return;
    }
    
    // Calculate deviation from initial orientation
    // Beta: forward/backward tilt (-180 to 180, where 0 is horizontal, positive is forward)
    // Gamma: left/right tilt (-90 to 90, where 0 is vertical, positive is right)
    let betaDeviation = (e.beta || 0) - initialBeta;
    let gammaDeviation = (e.gamma || 0) - initialGamma;
    
    // Normalize beta to reasonable range (clamp extreme values)
    // Typical phone tilt range is -45 to 45 degrees
    betaDeviation = Math.max(-45, Math.min(45, betaDeviation));
    gammaDeviation = Math.max(-45, Math.min(45, gammaDeviation));
    
    // Convert degrees to normalized values (-1 to 1) for parallax
    // Center of screen should correspond to 0 tilt
    const normalizedBeta = betaDeviation / 45; // -1 (backward) to 1 (forward)
    const normalizedGamma = gammaDeviation / 45; // -1 (left) to 1 (right)
    
    // Update current values (will be smoothed in draw loop)
    currentBeta = normalizedBeta;
    currentGamma = normalizedGamma;
}

// Request device orientation permission and setup handler
function setupDeviceOrientation() {
    // Only setup on mobile devices
    if (!isMobileDevice()) return;
    
    // Check if DeviceOrientationEvent is supported
    if (typeof DeviceOrientationEvent !== 'undefined') {
        // Request permission (required on iOS 13+)
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
            // iOS 13+ requires explicit permission
            DeviceOrientationEvent.requestPermission()
                .then(response => {
                    if (response === 'granted') {
                        window.addEventListener('deviceorientation', handleDeviceOrientation);
                        console.log('Device orientation permission granted');
                    } else {
                        console.log('Device orientation permission denied');
                    }
                })
                .catch(error => {
                    console.error('Error requesting device orientation permission:', error);
                });
        } else {
            // Android and older iOS - no permission needed
            window.addEventListener('deviceorientation', handleDeviceOrientation);
            console.log('Device orientation listener added (no permission needed)');
        }
    } else {
        console.log('DeviceOrientationEvent not supported');
    }
}

// Initialize back button and filter buttons after DOM is ready
// Initialize mobile version with xpan.earth style navigation
function initMobileHomepageNav() {
    if (!isMobileDevice()) {
        return;
    }
    
    isMobileVersion = true;
    updateMobileGridPointerState();
    startMobileAutoConnections();
    
    // Make all points inactive (no click interactions)
    points.forEach(point => {
        point.isInactive = true;
        point.targetOpacity = 1.0; // Keep visible as background
    });
    
    const mobileNav = document.getElementById('mobileHomepageNav');
    const navLines = document.getElementById('mobileNavLines');
    const navLabels = document.querySelectorAll('.mobile-nav-label');
    
    if (!mobileNav || !navLines || navLabels.length === 0) {
        return;
    }
    
    // Show navigation only after loading screen fades out (after "Welcome to Spatial Playground" completes)
    // Wait for loading indicator to be hidden
    const showMobileNav = () => {
        const loadingIndicator = document.getElementById('loadingIndicator');
        if (loadingIndicator && !loadingIndicator.classList.contains('hidden')) {
            // Loading screen still visible, check again after a short delay
            setTimeout(showMobileNav, 100);
            return;
        }
        // Loading screen has faded out, show mobile navigation
        mobileNav.classList.add('visible');
        drawMobileNavLines(navLines, navLabels);
    };
    
    // Start checking after a short delay to allow loading screen to start fading
    setTimeout(showMobileNav, 100);
    
    // Setup navigation label clicks
    navLabels.forEach(label => {
        label.addEventListener('click', (e) => {
            const category = label.getAttribute('data-category');
            handleMobileCategorySelect(category);
        });
    });
    
    // Setup mobile category back button
    const mobileCategoryBack = document.getElementById('mobileCategoryBack');
    if (mobileCategoryBack) {
        mobileCategoryBack.addEventListener('click', () => {
            handleMobileCategoryBack();
        });
    }
}

// Intersection for nav lines: center of viewport to stabilize layout across devices
function calculateLinesIntersection(labels) {
    const { width, height } = getViewportSize();
    return { x: width / 2, y: height / 2 };
}

// Calculate intersection point of two line segments
function lineIntersection(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 0.001) {
        // Lines are parallel, use center of screen as fallback
        const { width, height } = getViewportSize();
        return { x: width / 2, y: height / 2 };
    }
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    
    // Check if intersection is within both line segments
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
        return {
            x: x1 + t * (x2 - x1),
            y: y1 + t * (y2 - y1)
        };
    }
    
    // If not within segments, extend lines and find intersection
    const x = x1 + t * (x2 - x1);
    const y = y1 + t * (y2 - y1);
    return { x, y };
}

// Draw navigation lines from center intersection to labels
function drawMobileNavLines(svg, labels) {
    const svgNS = 'http://www.w3.org/2000/svg';
    const { width: vpW, height: vpH } = getViewportSize();
    
    // Clear existing lines
    svg.innerHTML = '';
    svg.setAttribute('viewBox', `0 0 ${vpW} ${vpH}`);
    svg.setAttribute('width', vpW);
    svg.setAttribute('height', vpH);
    
    // Calculate intersection point of lines connecting the 4 labels
    const intersection = calculateLinesIntersection(labels);
    const centerX = intersection ? intersection.x : vpW / 2;
    const centerY = intersection ? intersection.y : vpH / 2;
    
    // Position "we are" label at the intersection (center) with visible circle
    const weAreLabel = Array.from(labels).find(label => label.getAttribute('data-category') === 'we-are');
    if (weAreLabel && intersection) {
        // Position we are at intersection, accounting for label size
        const weAreRect = weAreLabel.getBoundingClientRect();
        const labelWidth = weAreRect.width;
        const labelHeight = weAreRect.height;
        weAreLabel.style.left = `${centerX - labelWidth / 2}px`;
        weAreLabel.style.top = `${centerY - labelHeight / 2}px`;
        weAreLabel.style.transform = 'translate(0, 0)';
        weAreLabel.style.position = 'absolute';
        weAreLabel.style.zIndex = '10003';
        weAreLabel.style.opacity = '1';
        // Ensure circle is visible by forcing pseudo container visibility
        weAreLabel.style.setProperty('pointer-events', 'auto');
    }
    
    // Draw lines from intersection to each of the 4 labels (excluding "we are")
    labels.forEach((label) => {
        const category = label.getAttribute('data-category');
        if (category === 'we-are') {
            return; // Skip "we are" - it's at the center
        }
        
        const rect = label.getBoundingClientRect();
        const labelX = rect.left + rect.width / 2;
        const labelY = rect.top + rect.height / 2;
        
        // Create line from intersection to label
        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', centerX);
        line.setAttribute('y1', centerY);
        line.setAttribute('x2', labelX);
        line.setAttribute('y2', labelY);
        line.setAttribute('stroke', '#fff');
        line.setAttribute('stroke-width', '0.5');
        line.setAttribute('opacity', '0.75'); // +25% vs 0.6 (mobile home only)
        
        svg.appendChild(line);
    });
}

// Handle mobile category selection
function handleMobileCategorySelect(category) {
    currentMobileCategory = category;
    
    // Keep canvas visible; we'll fade images/dotted lines instead
    const canvasEl = document.getElementById('canvas');
    if (canvasEl) {
        canvasEl.classList.remove('mobile-grid-fade-out');
    }
    
    // Hide navigation only in folder/list/selection modes (mobile)
    if (isMobileDevice()) {
        setMobileNavVisibility(false);
    }
    const mobileBack = document.getElementById('mobileCategoryBack');
    if (mobileBack) {
        mobileBack.style.position = 'fixed';
        mobileBack.style.left = '14px';
        mobileBack.style.right = '14px';
        mobileBack.style.bottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
        mobileBack.style.top = 'auto';
        mobileBack.style.background = 'transparent';
    }
    updateMobileGridPointerState();
    stopMobileAutoConnections();
    
    // Fade out all points (images) in random grid over 0.25s
    points.forEach(point => {
        if (!point.isAligned && !point.isFiltered) {
            point.targetOpacity = 0.0;
        }
    });
    // Fade out dotted lines
    stopMobileAutoConnections();
    mobileAutoLines = [];
    
    // Enter folder/index flow on mobile; keep overlay hidden so grid stays visible behind list
    if (isMobileDevice()) {
        if (category === 'we-are') {
            isWeAreMode = true; // Set we are mode flag
            showMobileCategoryContent(category);
            const mobileBack = document.getElementById('mobileCategoryBack');
            if (mobileBack) {
                mobileBack.style.display = 'flex';
                mobileBack.style.visibility = 'visible';
                mobileBack.style.opacity = '1';
                mobileBack.style.position = 'fixed';
                mobileBack.style.left = '14px';
                mobileBack.style.right = '14px';
                mobileBack.style.bottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
                mobileBack.style.top = 'auto';
                mobileBack.style.background = 'transparent';
                mobileBack.style.pointerEvents = 'auto';
                mobileBack.style.zIndex = '20000';
            }
            return;
        }
        const categoryContent = document.getElementById('mobileCategoryContent');
        if (categoryContent) {
            categoryContent.classList.remove('visible');
            categoryContent.style.pointerEvents = 'none';
            categoryContent.style.visibility = 'hidden';
            categoryContent.style.opacity = '0';
        }
        const tag = category === 'spatial' ? 'spatial' : category;
        filterByTag(tag);
        updateBackButtonVisibility();
    } else {
        // Desktop: preserve existing behaviour
    setTimeout(() => {
        showMobileCategoryContent(category);
        updateBackButtonVisibility();
    }, MOBILE_GRID_FADE_OUT_DURATION_MS);
    }
}

// Show mobile category content
function showMobileCategoryContent(category) {
    const categoryContent = document.getElementById('mobileCategoryContent');
    const categoryTitle = document.getElementById('mobileCategoryTitle');
    const categoryBody = document.getElementById('mobileCategoryBody');
    const mobileBack = document.getElementById('mobileCategoryBack');
    const contentInner = document.querySelector('.mobile-category-content-inner');
    
    if (!categoryContent || !categoryTitle || !categoryBody) {
        return;
    }
    
    // Show the inner content container (only for "we are" mode)
    if (contentInner) {
        contentInner.style.display = '';
        contentInner.style.visibility = 'visible';
        contentInner.style.opacity = '1';
    }
    
    // Ensure title/body are visible (they might have been hidden by folder about display)
    categoryTitle.style.display = '';
    categoryBody.style.display = '';
    
    // Remove any folder about elements that might be leftover
    const mobileAboutName = document.querySelector('.mobile-about-name');
    const mobileAboutInfo = document.querySelector('.mobile-about-info');
    if (mobileAboutName) mobileAboutName.remove();
    if (mobileAboutInfo) mobileAboutInfo.remove();
    
    if (mobileBack) {
        mobileBack.style.position = 'fixed';
        mobileBack.style.left = '14px';
        mobileBack.style.right = '14px';
        mobileBack.style.bottom = 'calc(16px + env(safe-area-inset-bottom, 0px))';
        mobileBack.style.top = 'auto';
        mobileBack.style.background = 'transparent';
    }
    
    // Set category title
    const categoryLabels = {
        'we-are': 'we are',
        'stage': 'stage design',
        'install': 'installation',
        'tech': 'technical solutions',
        'spatial': 'spatial design'
    };
    
    categoryTitle.textContent = categoryLabels[category] || category;
    
    // Set category body content
    if (category === 'we-are') {
        // Show "we are" about text from ABOUT_TEXT/ABOUT_TEXT_FR (defined in about.js)
        const aboutContent = getAboutText();
        if (aboutContent) {
            // Format text: preserve line breaks and paragraphs
            const formattedText = aboutContent.split('\n').map(line => {
                const t = line.trim();
                if (t === '') return '<br>';
                if (t.startsWith('<')) return t;
                return `<p style="margin-bottom: 1em;">${line}</p>`;
            }).join('');
            categoryBody.innerHTML = '<div style="line-height: 1.6; font-size: 14px;">' + formattedText + '</div>';
        } else {
            categoryBody.innerHTML = '<div style="line-height: 1.6; font-size: 14px;">We are a small studio working across spatial design, stage environments, spatial sound, and concept development.</div>';
        }
    } else {
        // Filter images by category
        const tag = category === 'spatial' ? 'concept' : category;
        filterByTag(tag);
        
        // Show filtered images info
        const filteredCount = filteredImages ? filteredImages.length : 0;
        categoryBody.innerHTML = `<div style="line-height: 1.6; font-size: 14px;">${filteredCount} projects</div>`;
    }
    
    // Show category content with fade in
    categoryContent.classList.add('visible');
    categoryContent.style.visibility = 'visible';
    categoryContent.style.opacity = '1';
}

// Handle mobile category back
function handleMobileCategoryBack() {
    // If in "we are" mode, clear it (fade out about text in 0.25s)
    if (isWeAreMode) {
        clearWeAreMode();
    currentMobileCategory = null;
        
        // Hide category content (fade out in 0.25s)
        const categoryContent = document.getElementById('mobileCategoryContent');
        if (categoryContent) {
            categoryContent.classList.remove('visible');
            categoryContent.style.pointerEvents = 'none';
            categoryContent.style.visibility = 'hidden';
            categoryContent.style.opacity = '0';
        }
        
        // Also hide the inner content
        const contentInner = document.querySelector('.mobile-category-content-inner');
        if (contentInner) {
            contentInner.style.display = 'none';
            contentInner.style.visibility = 'hidden';
            contentInner.style.opacity = '0';
        }
        
        // Show navigation again
        setMobileNavVisibility(true);
        
        // Hide the back button on main screen
        const mobileBack = document.getElementById('mobileCategoryBack');
        if (mobileBack) {
            mobileBack.style.display = 'none';
        }
        
        updateBackButtonVisibility();
        updateMobileGridPointerState();
        startMobileAutoConnections();
        requestAnimationFrame(function () { updateMobileGridPointerState(); });
        return;
    }
    
    // If in image selection mode (aligned images), return to folder list
    if (alignedEmojiIndex !== null && selectedIndexFolder !== null) {
        returnToFolderSelection();
        return;
    }
    
    // If in folder list mode, exit to main screen
    if (isIndexMode) {
        // Immediately unblock canvas so scroll/pan works on home (fixes mobile scroll after back)
        const indexList = document.getElementById('indexFolderList');
        if (indexList) {
            indexList.style.setProperty('pointer-events', 'none', 'important');
            indexList.style.setProperty('display', 'none', 'important');
        }
        const categoryContent = document.getElementById('mobileCategoryContent');
        if (categoryContent) {
            categoryContent.classList.remove('visible');
            categoryContent.style.pointerEvents = 'none';
            categoryContent.style.visibility = 'hidden';
            categoryContent.style.opacity = '0';
        }
        const contentInner = document.querySelector('.mobile-category-content-inner');
        if (contentInner) {
            contentInner.style.display = 'none';
            contentInner.style.visibility = 'hidden';
            contentInner.style.opacity = '0';
        }
        hideIndexFolderList();
        exitIndexMode();
        currentMobileCategory = null;
        
        // Show navigation again
        setMobileNavVisibility(true);
        
        // Fade in all points in random grid
        points.forEach(point => {
            point.targetOpacity = 1.0;
            point.isInactive = false;
        });
        
        // Hide the back button on main screen
        const mobileBack = document.getElementById('mobileCategoryBack');
        if (mobileBack) {
            mobileBack.style.display = 'none';
        }
        
        updateBackButtonVisibility();
        updateMobileGridPointerState();
        startMobileAutoConnections();
        requestAnimationFrame(function () { updateMobileGridPointerState(); });
        return;
    }
    
    currentMobileCategory = null;
    
    // Reset aligned state and restore originals (instant jump back)
    resetMobileSelectionLayout();
    
    // Hide category content
    const categoryContent = document.getElementById('mobileCategoryContent');
    if (categoryContent) {
        categoryContent.classList.remove('visible');
        categoryContent.style.pointerEvents = 'none';
        categoryContent.style.visibility = 'hidden';
        categoryContent.style.opacity = '0';
    }
    
    // Fade in random grid (canvas)
    const canvasEl = document.getElementById('canvas');
    if (canvasEl) {
        canvasEl.classList.remove('mobile-grid-fade-out');
    }
    
    // Show navigation again
    setMobileNavVisibility(true);
    
    // Fade in all points in random grid
    points.forEach(point => {
        if (!point.isAligned && !point.isFiltered) {
            point.targetOpacity = 1.0;
        }
    });
    
    // Clear filter if active
    if (isFilterMode) {
        clearFilter();
    }
    
    updateBackButtonVisibility();
    updateMobileGridPointerState();
    startMobileAutoConnections();
    
    // Hide the back button on main screen
    const mobileBack = document.getElementById('mobileCategoryBack');
    if (mobileBack) {
        mobileBack.style.display = 'none';
    }
    
    // Re-apply canvas pointer-events on next frame so touch/pan works after back
    requestAnimationFrame(function () {
        updateMobileGridPointerState();
    });
}

function runAppInit() {
    // Setup gyroscope parallax for mobile
    setupDeviceOrientation();
    
    // Ensure mobile category content is hidden on load
    const mobileCategoryContent = document.getElementById('mobileCategoryContent');
    if (mobileCategoryContent) {
        mobileCategoryContent.classList.remove('visible');
        mobileCategoryContent.style.opacity = '0';
        mobileCategoryContent.style.visibility = 'hidden';
        mobileCategoryContent.style.pointerEvents = 'none';
    }
    
    // Also hide the inner content on load
    const mobileCategoryInner = document.querySelector('.mobile-category-content-inner');
    if (mobileCategoryInner) {
        mobileCategoryInner.style.display = 'none';
        mobileCategoryInner.style.visibility = 'hidden';
        mobileCategoryInner.style.opacity = '0';
    }
    
    // Initialize mobile version
    initMobileHomepageNav();
    
    // Cache back button for performance
    cachedBackButton = document.getElementById('backButton');
    if (cachedBackButton) {
        var lastBackTap = 0;
        var handleBack = function () {
            var now = Date.now();
            if (now - lastBackTap < 400) return;
            lastBackTap = now;
            if (isMobileVersion) {
                mobileReturnHome();
                return;
            }
            if (isWeAreMode) {
                clearWeAreMode();
            } else if (isIndexMode) {
                if (selectedIndexFolder !== null || alignedEmojiIndex !== null) {
                    returnToFolderSelection();
                } else {
                    exitIndexMode();
                }
            } else if (isFilterMode) {
                clearFilter();
            } else if (isConnectionMode) {
                exitConnectionMode();
            } else {
                unalignEmojis();
            }
        };
        cachedBackButton.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            handleBack();
        });
        cachedBackButton.addEventListener('touchstart', function (e) {
            e.preventDefault();
            handleBack();
        }, { passive: false });
    }
    
    // Setup filter buttons (only for desktop)
    if (!isMobileDevice()) {
    positionFilterButtons();
        let filterButtonsRaf = 0;
    window.addEventListener('resize', () => {
            if (filterButtonsRaf) cancelAnimationFrame(filterButtonsRaf);
            filterButtonsRaf = requestAnimationFrame(() => {
                filterButtonsRaf = 0;
        positionFilterButtons();
        if (isWeAreMode) {
            const aboutTextEl = document.getElementById('aboutText');
            const weAreBtn = document.getElementById('weAreButton');
            if (aboutTextEl && weAreBtn) {
                const rect = weAreBtn.getBoundingClientRect();
                aboutTextEl.style.left = `${rect.left}px`;
            }
        }
            });
    });
    
    // EN/FR lang switch
    const langEn = document.getElementById('langEn');
    const langFr = document.getElementById('langFr');
    function updateLangActive() {
        var locale = typeof window !== 'undefined' ? window.__LOCALE__ : 'en';
        if (langEn) langEn.style.opacity = locale === 'en' ? '1' : '0.5';
        if (langFr) langFr.style.opacity = locale === 'fr' ? '1' : '0.5';
    }
    if (langEn) {
        langEn.addEventListener('click', function (e) {
            e.stopPropagation();
            if (window.__LOCALE__ === 'en') return;
            window.__LOCALE__ = 'en';
            updateLangActive();
            if (isWeAreMode) showWeAreAbout();
            else if (currentMobileCategory === 'we-are') showMobileCategoryContent('we-are');
        });
    }
    if (langFr) {
        langFr.addEventListener('click', function (e) {
            e.stopPropagation();
            if (window.__LOCALE__ === 'fr') return;
            window.__LOCALE__ = 'fr';
            updateLangActive();
            if (isWeAreMode) showWeAreAbout();
            else if (currentMobileCategory === 'we-are') showMobileCategoryContent('we-are');
        });
    }
    updateLangActive();

    const filterButtons = document.querySelectorAll('.filter-button');
    filterButtons.forEach(btn => {
        // Prevent mousedown from bubbling to canvas AND clear hover state immediately
        btn.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            clearHoverState(); // Clear hover immediately to prevent image zoom
        });
        btn.addEventListener('touchstart', (e) => {
            e.stopPropagation();
            clearHoverState(); // Clear hover immediately to prevent image zoom
        }, { passive: true });
        
        // Also clear on mouseenter to prevent any hover effects while over buttons
        btn.addEventListener('mouseenter', () => {
            clearHoverState();
        });
        
        if (btn.id === 'weAreButton') {
            // Handle "we are" button - show about text
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                showWeAreAbout();
            });
        } else if (btn.id === 'langEn' || btn.id === 'langFr') {
            // Lang buttons handled above
        } else {
            const tag = btn.getAttribute('data-tag');
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                filterByTag(tag);
            });
        }
    });
    }
    
    // Redraw lines on resize for mobile
    if (isMobileDevice()) {
        let resizeRaf = 0;
        window.addEventListener('resize', () => {
            if (resizeRaf) cancelAnimationFrame(resizeRaf);
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = 0;
                const navLines = document.getElementById('mobileNavLines');
                const navLabels = document.querySelectorAll('.mobile-nav-label');
                if (navLines && navLabels.length > 0 && isMobileVersion) {
                    drawMobileNavLines(navLines, navLabels);
                }
            });
        });
    }
    
    // Selection mode prev/next: one screen left/right with smooth transition
    const selectionPrevBtn = document.getElementById('selectionPrevBtn');
    const selectionNextBtn = document.getElementById('selectionNextBtn');
    if (selectionPrevBtn) {
        selectionPrevBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (alignedEmojiIndex === null) return;
            const w = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 800;
            targetCameraPanX += w;
        });
    }
    if (selectionNextBtn) {
        selectionNextBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (alignedEmojiIndex === null) return;
            const w = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 800;
            targetCameraPanX -= w;
        });
    }
}
// Run init when DOM is ready (or immediately if script loads late, e.g. React dynamic load)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runAppInit);
} else {
    runAppInit();
}

// ========== About.txt functionality ==========

// Create project about text DOM elements if they don't exist
function createProjectAboutElements() {
    let containerEl = document.getElementById('projectAboutText');
    if (!containerEl) {
        containerEl = document.createElement('div');
        containerEl.id = 'projectAboutText';
        containerEl.className = 'project-about-text';
        containerEl.style.display = 'none';
        document.body.appendChild(containerEl);
    }
    
    let nameEl = document.getElementById('projectName');
    if (!nameEl) {
        nameEl = document.createElement('div');
        nameEl.id = 'projectName';
        nameEl.className = 'project-name';
        containerEl.appendChild(nameEl);
    }
    
    let infoEl = document.getElementById('projectInfo');
    if (!infoEl) {
        infoEl = document.createElement('div');
        infoEl.id = 'projectInfo';
        infoEl.className = 'project-info';
        containerEl.appendChild(infoEl);
    }
    
    let moreEl = document.getElementById('projectMore');
    if (!moreEl) {
        moreEl = document.createElement('div');
        moreEl.id = 'projectMore';
        moreEl.className = 'project-more';
        moreEl.style.cssText = 'font-family: \'Grammatika Demo\', Arial, sans-serif; font-size: 14px; color: #fff; white-space: pre-wrap; word-break: break-word; line-height: 1.6; display: none; overflow-y: auto; box-sizing: border-box;';
        containerEl.appendChild(moreEl);
    }
    
    return { containerEl, nameEl, infoEl, moreEl };
}

// Load and display about.txt and more.txt from folder
function loadAndDisplayAboutText(folderPath) {
    if (!folderPath) {
        displayProjectAboutText('~', [], null);
        return;
    }
    
    const pathWithoutPrefix = folderPath.replace(/^final images\//, '');
    const encodedPath = pathWithoutPrefix.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : '';
    const pathPrefix = (typeof window !== 'undefined' && window.__BASE_URL__) ? window.__BASE_URL__.replace(/\/$/, '') : '';
    const base = origin + pathPrefix + '/img/' + encodedPath.replace(/^\//, '');
    const aboutUrl = base + '/about.txt';
    const moreUrl = base + '/more.txt';
    const extraUrl = base + '/extra.txt';
    
    const aboutPromise = fetch(aboutUrl).then(r => r.ok ? r.text() : Promise.reject(new Error('about')));
    const morePromise = fetch(moreUrl).then(r => r.ok ? r.text() : null).catch(() => null);
    const extraPromise = fetch(extraUrl).then(r => r.ok ? r.text() : null).catch(() => null);
    Promise.all([aboutPromise, morePromise, extraPromise])
        .then(([aboutText, moreText, extraText]) => {
            const moreContent = (moreText && moreText.trim()) || (extraText && extraText.trim()) || null;
            parseAndDisplayAboutText(aboutText, moreContent ? (moreContent.trim()) : null);
        })
        .catch(() => {
            displayProjectAboutText('~', [], null);
        });
}

// Parse about.txt content for mobile display (same label map as desktop)
function parseAndDisplayMobileAboutText(text) {
    if (!text || !text.trim()) {
        displayMobileAboutText('~', []);
        return;
    }
    
    const parts = text.split('#');
    const nameBlock = parts[0].trim();
    const aboutBlock = parts.length >= 2 ? parts[1].trim() : text;
    
    let name = '~';
    const nameMatchWithParens = nameBlock.match(/(?:name|Name):\s*\(([^)]+)\)/i);
    const nameMatchWithoutParens = nameBlock.match(/(?:name|Name):\s*([^\n\r]+)/i);
    if (nameMatchWithParens) name = nameMatchWithParens[1].trim();
    else if (nameMatchWithoutParens) name = nameMatchWithoutParens[1].trim();
    
    const aboutLines = [];
    const labelMap = [
        { key: 'project', re: /project\s*type:\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'client', re: /client:\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'studio', re: /(?:studio|agency):\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'year', re: /year:\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'location', re: /location:\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'project status', re: /status:\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'contributor', re: /contributor:\s*(?:\(([^)]+)\)|([^\n\r]+))/i }
    ];
    labelMap.forEach(function (item) {
        const match = aboutBlock.match(item.re);
        if (match) {
            const value = (match[1] || match[2] || '').trim();
            if (value) aboutLines.push({ label: item.key, value: value });
        }
    });
    
    displayMobileAboutText(name, aboutLines);
}

// Display about text in mobile category content inner (top left)
function displayMobileAboutText(name, aboutLines) {
    const contentInner = document.querySelector('.mobile-category-content-inner');
    if (!contentInner) return;
    
    // Remove any existing mobile about elements (but preserve title/body for "we are" mode)
    const existingName = contentInner.querySelector('.mobile-about-name');
    const existingInfo = contentInner.querySelector('.mobile-about-info');
    if (existingName) existingName.remove();
    if (existingInfo) existingInfo.remove();
    
    // Hide the title/body elements (used by "we are" mode)
    const categoryTitle = document.getElementById('mobileCategoryTitle');
    const categoryBody = document.getElementById('mobileCategoryBody');
    if (categoryTitle) categoryTitle.style.display = 'none';
    if (categoryBody) categoryBody.style.display = 'none';
    
    // Create project name element (top left)
    const nameEl = document.createElement('div');
    nameEl.className = 'mobile-about-name';
    nameEl.textContent = name || '~';
    nameEl.style.cssText = `
        font-size: 18px;
        font-weight: 400;
        color: #fff;
        margin-bottom: 16px;
        text-align: left;
        opacity: 0;
        transition: opacity 0.25s ease-out;
    `;
    contentInner.appendChild(nameEl);
    
    // Create info lines container
    const infoContainer = document.createElement('div');
    infoContainer.className = 'mobile-about-info';
    infoContainer.style.cssText = `
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
        text-align: left;
        line-height: 1.6;
    `;
    
    aboutLines.forEach((line, index) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'mobile-about-line';
        lineEl.textContent = `${line.label}: ${line.value}`;
        lineEl.style.cssText = `
            opacity: 0;
            transition: opacity 0.25s ease-out;
        `;
        infoContainer.appendChild(lineEl);
        
        // Staggered fade in
        setTimeout(() => {
            lineEl.style.opacity = '1';
        }, 300 + (index * 150));
    });
    
    contentInner.appendChild(infoContainer);
    
    // Show the mobile category content
    const categoryContent = document.getElementById('mobileCategoryContent');
    if (categoryContent) {
        categoryContent.classList.add('visible');
        categoryContent.style.pointerEvents = 'none';
        categoryContent.style.visibility = 'visible';
        categoryContent.style.opacity = '1';
        categoryContent.style.background = 'transparent';
    }
    
    // Fade in name
    setTimeout(() => {
        nameEl.style.opacity = '1';
    }, 100);
}

// Hide mobile about text (only clears dynamically added about text, preserves title/body elements)
function hideMobileAboutText() {
    // Only remove the dynamically added mobile about elements, NOT the existing title/body
    const mobileAboutName = document.querySelector('.mobile-about-name');
    const mobileAboutInfo = document.querySelector('.mobile-about-info');
    
    if (mobileAboutName) {
        mobileAboutName.remove();
    }
    if (mobileAboutInfo) {
        mobileAboutInfo.remove();
    }
    
    // Restore the title/body elements visibility (used by "we are" mode)
    const categoryTitle = document.getElementById('mobileCategoryTitle');
    const categoryBody = document.getElementById('mobileCategoryBody');
    if (categoryTitle) categoryTitle.style.display = '';
    if (categoryBody) categoryBody.style.display = '';
    
    // Don't remove 'visible' class here - let the calling code handle that
    // to avoid conflicts with "we are" mode which also uses mobileCategoryContent
}

// Parse about.txt content (supports name, Project type, year, Location, Client, Agency, Status, Contributor)
function parseAndDisplayAboutText(text, moreText) {
    if (!text || !text.trim()) {
        displayProjectAboutText('~', [], moreText || null);
        return;
    }
    
    // Split by # separator (if present)
    const parts = text.split('#');
    const nameBlock = parts[0].trim();
    const aboutBlock = parts.length >= 2 ? parts[1].trim() : text;
    
    // Extract name (with or without parentheses)
    let name = '~';
    const nameMatchWithParens = nameBlock.match(/(?:name|Name):\s*\(([^)]+)\)/i);
    const nameMatchWithoutParens = nameBlock.match(/(?:name|Name):\s*([^\n\r]+)/i);
    
    if (nameMatchWithParens) {
        name = nameMatchWithParens[1].trim();
    } else if (nameMatchWithoutParens) {
        name = nameMatchWithoutParens[1].trim();
    }
    
    // Extract about lines: map file labels to display labels (supports parentheses or plain value)
    const aboutLines = [];
    const labelMap = [
        { key: 'project', re: /project\s*type:\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'client', re: /client:\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'studio', re: /(?:studio|agency):\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'year', re: /year:\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'location', re: /location:\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'project status', re: /status:\s*(?:\(([^)]+)\)|([^\n\r]+))/i },
        { key: 'contributor', re: /contributor:\s*(?:\(([^)]+)\)|([^\n\r]+))/i }
    ];
    labelMap.forEach(function (item) {
        const match = aboutBlock.match(item.re);
        if (match) {
            const value = (match[1] || match[2] || '').trim();
            if (value) aboutLines.push({ label: item.key, value: value });
        }
    });
    
    // Include any line that looks like "Label: value" and was not already matched by labelMap
    const lines = aboutBlock.split(/\r?\n/);
    lines.forEach(function (rawLine) {
        const line = rawLine.trim();
        if (!line) return;
        var alreadyMatched = labelMap.some(function (item) { return item.re.test(line); });
        if (alreadyMatched) return;
        const colonMatch = line.match(/^([^:#]+):\s*([\s\S]*)$/);
        if (!colonMatch) return;
        const fileLabel = colonMatch[1].trim().toLowerCase().replace(/\s+/g, ' ');
        const value = colonMatch[2].trim();
        if (!value) return;
        aboutLines.push({ label: fileLabel, value: value });
    });
    
    displayProjectAboutText(name, aboutLines, moreText || null);
}

// Display project about text (desktop and mobile); more.txt in red zone (right of info, same font/size)
// Fade-in: line by line (name -> info lines -> more)
function displayProjectAboutText(name, aboutLines, moreContent) {
    const { containerEl, nameEl, infoEl, moreEl } = createProjectAboutElements();
    
    const aboutLineStep = 180; // ms between each line fade-in
    const aboutTransition = 'opacity 0.4s ease-out';

    nameEl.textContent = name || '~';
    nameEl.style.opacity = '0';
    nameEl.style.transition = aboutTransition;
    setTimeout(() => { nameEl.style.opacity = '1'; }, 0);
    
    infoEl.innerHTML = '';
    aboutLines.forEach((line, index) => {
        const lineEl = document.createElement('div');
        lineEl.className = 'info-line';
        lineEl.textContent = `${line.label}: ${line.value}`;
        lineEl.style.opacity = '0';
        lineEl.style.transition = aboutTransition;
        infoEl.appendChild(lineEl);
        setTimeout(() => {
            lineEl.style.opacity = '1';
        }, aboutLineStep * (index + 1));
    });

    const moreDelay = aboutLineStep * (aboutLines.length + 1);
    if (moreEl) {
        if (moreContent && moreContent.trim()) {
            moreEl.innerHTML = '';
            moreEl.style.display = 'block';
            moreEl.style.visibility = 'visible';
            // more.txt: line-by-line fade-in (same as about.txt)
            const moreLines = moreContent.trim().split(/\r?\n/).filter(l => l.trim());
            moreLines.forEach((line, idx) => {
                const lineEl = document.createElement('div');
                lineEl.className = 'more-line';
                lineEl.textContent = line.trim();
                lineEl.style.opacity = '0';
                lineEl.style.transition = aboutTransition;
                moreEl.appendChild(lineEl);
                setTimeout(() => { lineEl.style.opacity = '1'; }, moreDelay + aboutLineStep * (idx + 1));
            });
        } else {
            moreEl.textContent = '';
            moreEl.style.display = 'none';
        }
    }

    containerEl.style.display = 'block';
    containerEl.style.visibility = 'visible';
    containerEl.style.opacity = '1';
    containerEl.classList.add('visible');
    containerEl.style.transition = 'opacity 0.25s ease-out';
    containerEl.style.zIndex = '10001';
    containerEl.style.pointerEvents = 'none';
    nameEl.style.visibility = 'visible';
    infoEl.style.visibility = 'visible';
    
    if (isMobileDevice()) {
        // Mobile: position handled by draw() using world coords (same approach as more.txt)
        if (containerEl.parentNode && containerEl.parentNode !== document.body) {
            document.body.appendChild(containerEl);
        }
        const categoryContent = document.getElementById('mobileCategoryContent');
        if (categoryContent) {
            categoryContent.classList.add('visible');
            categoryContent.style.pointerEvents = 'none';
            categoryContent.style.visibility = 'visible';
            categoryContent.style.opacity = '1';
            categoryContent.style.background = 'transparent';
        }
        containerEl.style.position = 'fixed';
        containerEl.style.display = 'flex';
        containerEl.style.flexDirection = 'column';
        containerEl.style.alignItems = 'stretch';
        containerEl.style.gap = '10px';
        containerEl.style.overflow = 'visible';
        containerEl.style.zIndex = '10002';
        containerEl.style.transform = 'none';
        nameEl.style.position = 'static';
        nameEl.style.textAlign = 'left';
        infoEl.style.position = 'static';
        infoEl.style.textAlign = 'left';
        if (moreEl && moreEl.textContent.trim()) moreEl.style.visibility = 'hidden';
        void containerEl.offsetHeight;
        setTimeout(() => { nameEl.style.opacity = '1'; }, 0);
        // Trigger relayout so about block space is reserved in the gallery
        scheduleAlignedMobileRelayoutIfNeeded();
    }
    
    // Desktop: default position; updateProjectAboutTextPosition will set exact positions
    if (!isMobileDevice()) {
        containerEl.style.left = '40px';
        containerEl.style.right = 'auto';
        containerEl.style.top = 'auto';
        containerEl.style.bottom = '20px';
    }
    void containerEl.offsetHeight;
    
    // Update position every frame (desktop only; mobile positioning is in draw())
    if (window.updateProjectAboutTextPos) {
        cancelAnimationFrame(window.updateProjectAboutTextPos);
    }
    
    if (!isMobileDevice()) {
        const updatePosition = () => {
            if (alignedEmojis && alignedEmojis.length > 0) {
                updateProjectAboutTextPosition(containerEl, nameEl, infoEl);
                window.updateProjectAboutTextPos = requestAnimationFrame(updatePosition);
            } else {
                if (window.updateProjectAboutTextPos) {
                    cancelAnimationFrame(window.updateProjectAboutTextPos);
                    window.updateProjectAboutTextPos = null;
                }
            }
        };
        updatePosition();
    }
}

// Update project about text position based on aligned images (desktop + mobile)
function updateProjectAboutTextPosition(containerEl, nameEl, infoEl) {
    if (!alignedEmojis || alignedEmojis.length === 0) {
        return;
    }
    
    const firstImage = alignedEmojis[0];
    const lastImage = alignedEmojis[alignedEmojis.length - 1];
    
    if (!firstImage || !lastImage) {
        return;
    }
    
    // Mobile: positioning handled by draw() using world coords
    if (isMobileDevice()) return;

    const zoom = globalZoomLevel;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Get image dimensions for first image
    const firstImageData = imageCache[firstImage.imagePath];
    const firstImageHeight = firstImage.currentSize || firstImage.targetSize || baseEmojiSize;
    const firstImageAspectRatio = (firstImageData && firstImageData.aspectRatio) ? firstImageData.aspectRatio : 1;
    const firstImageWidth = firstImageHeight * firstImageAspectRatio;
    
    // Calculate screen positions (depend on cameraPan → scrolls with content)
    const firstImageCenterX = firstImage.currentAlignedX || firstImage.targetX || 0;
    const firstImageCenterY = firstImage.currentAlignedY || firstImage.targetY || 0;
    const firstImageTopY = firstImageCenterY - (firstImageHeight / 2);
    const firstImageLeftX = firstImageCenterX - (firstImageWidth / 2);
    const firstImageRightX = firstImageCenterX + (firstImageWidth / 2);
    
    let firstImageTopScreenY = ((firstImageTopY - centerY) * zoom) + centerY + cameraPanY;
    let firstImageLeftScreenX = ((firstImageLeftX - centerX) * zoom) + centerX + cameraPanX;
    let firstImageRightScreenX = ((firstImageRightX - centerX) * zoom) + centerX + cameraPanX;
    const margin = 20;
    const maxLeft = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth - 300 : 400;
    firstImageLeftScreenX = Math.max(margin, Math.min(maxLeft, firstImageLeftScreenX));
    firstImageRightScreenX = Math.max(firstImageLeftScreenX + 50, Math.min((window.innerWidth || 800) - margin, firstImageRightScreenX));
    firstImageTopScreenY = Math.max(margin, Math.min((window.innerHeight || 600) - margin, firstImageTopScreenY));
    
    // Get image dimensions for last image (desktop)
    const lastImageData = imageCache[lastImage.imagePath];
    const lastImageHeight = lastImage.currentSize || lastImage.targetSize || baseEmojiSize;
    const lastImageAspectRatio = (lastImageData && lastImageData.aspectRatio) ? lastImageData.aspectRatio : 1;
    const lastImageWidth = lastImageHeight * lastImageAspectRatio;
    
    const lastImageCenterY = lastImage.currentAlignedY || lastImage.targetY || 0;
    const lastImageBottomY = lastImageCenterY + (lastImageHeight / 2);
    let lastImageBottomScreenY = ((lastImageBottomY - centerY) * zoom) + centerY + cameraPanY;
    lastImageBottomScreenY = Math.max(firstImageTopScreenY + 40, Math.min((window.innerHeight || 600) - margin, lastImageBottomScreenY));
    
    {
        // Desktop: align about block to left edge of first image; smooth Y during phase 2/0 to avoid jitter
        const textGap = 15;
        const firstImageBottomScreenY = firstImageTopScreenY + (firstImageHeight * zoom);
        const screenHeight = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 600;
        const screenW = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1200;
        const screenH = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : 600;
        // After selection animation completes (phase 0): fix X so text only moves on Y when images pan
        const animationComplete = selectionAnimationPhase === 0;
        let aboutLeftPx;
        if (animationComplete && selectionAboutFixedLeftPx != null) {
            aboutLeftPx = selectionAboutFixedLeftPx;
    } else {
            aboutLeftPx = Math.round(firstImageLeftScreenX);
            if (animationComplete) selectionAboutFixedLeftPx = aboutLeftPx;
        }
        const rawNameBottom = screenHeight - firstImageTopScreenY + textGap;
        const rawInfoTop = firstImageBottomScreenY + textGap;
        const rawMoreTop = firstImageBottomScreenY + textGap;
        const duringPhase = selectionAnimationPhase !== 0;
        const smoothFactor = duringPhase ? 0.1 : 0.22;
        if (aboutSmoothedNameBottomPx == null) {
            aboutSmoothedNameBottomPx = rawNameBottom;
            aboutSmoothedInfoTopPx = rawInfoTop;
            aboutSmoothedMoreTopPx = rawMoreTop;
        } else {
            aboutSmoothedNameBottomPx += (rawNameBottom - aboutSmoothedNameBottomPx) * smoothFactor;
            aboutSmoothedInfoTopPx += (rawInfoTop - aboutSmoothedInfoTopPx) * smoothFactor;
            aboutSmoothedMoreTopPx += (rawMoreTop - aboutSmoothedMoreTopPx) * smoothFactor;
        }
        nameEl.style.position = 'fixed';
        nameEl.style.left = `${aboutLeftPx}px`;
        nameEl.style.right = 'auto';
        nameEl.style.top = 'auto';
        nameEl.style.bottom = `${Math.round(aboutSmoothedNameBottomPx)}px`;
        nameEl.style.textAlign = 'left';
        
        infoEl.style.position = 'fixed';
        infoEl.style.left = `${aboutLeftPx}px`;
        infoEl.style.right = 'auto';
        infoEl.style.top = `${Math.round(aboutSmoothedInfoTopPx)}px`;
        infoEl.style.textAlign = 'left';
        
        const moreEl = document.getElementById('projectMore');
        if (moreEl && moreEl.style.display === 'block' && moreEl.textContent.trim()) {
            const gap = 24;
            const marginRight = 48;
            let redZoneLeft = Math.max(aboutLeftPx + (infoEl.offsetWidth || 0) + gap, screenW * 0.38);
            if (animationComplete && selectionMoreFixedLeftPx != null) redZoneLeft = selectionMoreFixedLeftPx;
            else if (animationComplete) selectionMoreFixedLeftPx = redZoneLeft;
            const redZoneWidth = Math.max(200, screenW - redZoneLeft - marginRight);
            const redZoneHeight = Math.max(180, screenH - Math.round(aboutSmoothedMoreTopPx) - textGap - 100);
            moreEl.style.position = 'fixed';
            moreEl.style.left = `${redZoneLeft}px`;
            moreEl.style.right = 'auto';
            moreEl.style.top = `${Math.round(aboutSmoothedMoreTopPx)}px`;
            moreEl.style.width = `${redZoneWidth}px`;
            moreEl.style.maxHeight = `${redZoneHeight}px`;
            moreEl.style.fontSize = '14px';
            moreEl.style.textAlign = 'left';
            moreEl.style.overflowY = 'auto';
        }
        
        containerEl.style.position = 'fixed';
        containerEl.style.left = `${aboutLeftPx}px`;
        containerEl.style.right = 'auto';
    }
}

// Hide project about text (fade out in 0.1s when clicking back from selection)
function hideProjectAboutText() {
    aboutSmoothedNameBottomPx = null;
    aboutSmoothedInfoTopPx = null;
    aboutSmoothedMoreTopPx = null;
    selectionAboutFixedLeftPx = null;
    selectionMoreFixedLeftPx = null;
    // Also hide mobile about text
    if (isMobileDevice()) {
        hideMobileAboutText();
    }
    
    const containerEl = document.getElementById('projectAboutText');
    if (!containerEl) {
        return;
    }
    
    containerEl.classList.remove('visible');
    containerEl.style.transition = 'opacity 0.1s ease-out';
    containerEl.style.opacity = '0';
    
    const moreEl = document.getElementById('projectMore');
    if (moreEl) {
        moreEl.textContent = '';
        moreEl.style.display = 'none';
    }
    
    setTimeout(() => {
        containerEl.style.display = 'none';
    }, 100);
    
    if (window.updateProjectAboutTextPos) {
        cancelAnimationFrame(window.updateProjectAboutTextPos);
        window.updateProjectAboutTextPos = null;
    }
}

// Create elements on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createProjectAboutElements);
} else {
    createProjectAboutElements();
}

// Start animation - only if canvas is ready
if (canvas && ctx) {
animate();
} else {
    console.error('Cannot start animation: canvas or context not available');
}

// Redraw on resize
let resizeRaf = 0;
window.addEventListener('resize', () => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
        resizeRaf = 0;
    resizeCanvas();
        // Invalidate mobile detection cache on resize
        if (draw._isMobileCached !== undefined) {
            draw._isMobileCached = undefined;
        }
        // Regenerate points for new canvas size (debounced to avoid thrash while resizing)
    const newPoints = generatePoints(Math.min(imagePaths.length, 500), 50);
    points.length = 0;
    points.push(...newPoints);
    precomputeConnectionTrajectories(); // Recompute so dotted-line hover uses current point refs
    // Update mouse position
    targetMouseX = canvas.width / 2;
    targetMouseY = canvas.height / 2;
    smoothMouseX = targetMouseX;
    smoothMouseY = targetMouseY;
    });
});
