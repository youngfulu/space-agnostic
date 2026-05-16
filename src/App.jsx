import { useEffect } from 'react';

/**
 * React shell: DOM structure for legacy script.js (canvas grid, filters, about).
 */
function App() {
  useEffect(() => {
    // Strict Mode remounts in dev; refs reset but duplicate script.js breaks the canvas (double init).
    if (typeof window !== 'undefined' && window.__SPACE_AGNOSTIC_LEGACY_BOOT__) {
      return;
    }
    if (typeof window !== 'undefined') {
      window.__SPACE_AGNOSTIC_LEGACY_BOOT__ = true;
    }

    // Base path: / for local, /space-agnostic/ for GitHub Pages
    function getBasePath() {
      const pathname = (window.location && window.location.pathname) || '';
      if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes(':')) return '/';
      if (
        pathname === '/space-agnostic' ||
        pathname === '/space-agnostic/' ||
        pathname.startsWith('/space-agnostic/')
      ) {
        return '/space-agnostic/';
      }
      if (pathname === '/' || pathname === '') return '/';
      const match = pathname.match(/^(.+\/)\.?/);
      return match ? match[1] : '/';
    }
    const base = getBasePath();
    const baseNoTrailing = base.replace(/\/$/, '') || '';
    window.__IMAGE_BASE__ = baseNoTrailing + '/img';
    window.__BASE_URL__ = base;

    const loadScript = (src) =>
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`Failed to load ${src}`));
        document.body.appendChild(s);
      });

    const scriptBase = base.startsWith('/') ? (window.location.origin || '') + base : base;
    const bust = '?v=' + Date.now();
    loadScript(scriptBase + 'about.js' + bust)
      .then(() => loadScript(scriptBase + 'script.js' + bust))
      .catch((err) => console.error('Script load error:', err));
  }, []);

  return (
    <>
      <div id="loadingIndicator" className="loading-indicator">
        {/* Centered title + choice buttons */}
        <div className="loading-indicator-inner">
          <div id="loadingText" className="loading-text"></div>
          <div id="loadingChoiceButtons" className="loading-choice-buttons">
            <span id="choiceExplore" className="loading-choice-btn">explore</span>
            <span className="loading-choice-sep">/</span>
            <span id="choiceIndex" className="loading-choice-btn">index</span>
          </div>
        </div>
        {/* Progress bar fixed at page bottom */}
        <div
          id="loadingProgressBar"
          className="loading-progress-bar"
          aria-hidden="true"
        >
          {/* Width is set ONLY by script.js (updateLoadingProgressBar). Do not set width here or React will overwrite it on re-render. */}
          <div
            id="loadingProgressBarFill"
            className="loading-progress-bar-fill"
          />
        </div>
      </div>

      <div id="projectIndex" className="project-index">
        <div className="project-index-topbar">
          <span id="indexBackBtn" className="project-index-back-btn">← explore</span>
        </div>
        <div id="projectIndexList" className="project-index-list"></div>
        <div id="projectIndexPreview" className="project-index-preview" aria-hidden="true">
          <img id="projectIndexPreviewImg" src="" alt="" />
        </div>
      </div>

      <div id="projectGallery" className="project-gallery">
        {/* Top bar */}
        <div className="gallery-top-bar">
          <span id="galleryBackBtn" className="gallery-back-btn">← index</span>
        </div>
        {/* Two-panel body */}
        <div className="gallery-body">
          {/* Left: text info */}
          <div className="gallery-text-panel">
            <div id="galleryProjectName" className="gallery-proj-name"></div>
            <div id="galleryProjectType" className="gallery-proj-type"></div>
            <div id="galleryAboutFields" className="gallery-about-fields"></div>
            <div id="galleryMoreText" className="gallery-more-text"></div>
          </div>
          {/* Right: random image canvas */}
          <div id="galleryImageArea" className="gallery-image-area"></div>
        </div>
        {/* Carousel nav */}
        <button id="galleryPrevBtn" className="gallery-nav-btn gallery-prev-btn" type="button" aria-label="prev">&#8592;</button>
        <button id="galleryNextBtn" className="gallery-nav-btn gallery-next-btn" type="button" aria-label="next">&#8594;</button>
      </div>

      <canvas id="canvas"></canvas>

      {/* "index" button visible during explore mode — mirrors "← explore" in index topbar */}
      <span id="exploreIndexBtn" className="explore-index-btn" style={{ display: 'none' }}>index →</span>

      {/* About overlay — full-screen click catcher; panel is child so clicks inside don't bubble */}
      <div id="aboutOverlay" style={{ display: 'none' }}>
        <div id="aboutPanel"></div>
      </div>

      <div id="projectAboutText" className="project-about-text" style={{ display: 'none' }}>
        <div id="projectName" className="project-name"></div>
        <div id="projectInfo" className="project-info"></div>
        <div id="projectMore" className="project-more" style={{ display: 'none' }}></div>
      </div>

      <span className="filter-button" id="weAreButton">about</span>

      <div id="filterButtons" className="filter-buttons">
        <span className="filter-button" data-tag="stage">visual research</span>
        <span className="filter-button" data-tag="install">spatial design</span>
        <span className="filter-button" data-tag="tech">sonic core</span>
        <span className="filter-button" data-tag="concept">materiality</span>
        <span className="filter-button" data-tag="spatial">perform</span>
        <button id="backButton" className="back-button" type="button" style={{ display: 'none' }}>
          ← back
        </button>
        <div className="lang-buttons">
          <span className="filter-button" id="langEn" data-lang="en">EN</span>
          <span className="filter-button" id="langFr" data-lang="fr">FR</span>
        </div>
      </div>

      <div id="indexFolderList" className="index-folder-list"></div>

      <div id="mobileHomepageNav" className="mobile-homepage-nav">
        <svg id="mobileNavLines" className="mobile-nav-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* Lines drawn by script.js */}
        </svg>
        <div className="mobile-nav-labels">
          <div className="mobile-nav-label" data-category="we-are">about</div>
          <div className="mobile-nav-label" data-category="install">spatial design</div>
          <div className="mobile-nav-label" data-category="tech">sonic core</div>
          <div className="mobile-nav-label" data-category="stage">visual research</div>
          <div className="mobile-nav-label" data-category="spatial">perform</div>
          <div className="mobile-nav-label" data-category="index">index</div>
          <div className="mobile-nav-label" data-category="materiality">materiality</div>
        </div>
      </div>

      <div id="mobileCategoryContent" className="mobile-category-content">
        <div className="mobile-category-content-inner">
          <div id="mobileCategoryTitle" className="mobile-category-title"></div>
          <div id="mobileCategoryBody"></div>
        </div>
      </div>

      {/* Back button is a top-level fixed element so its z-index is not bounded by mobileCategoryContent's stacking context */}
      <button id="mobileCategoryBack" className="mobile-category-back" style={{ display: 'none' }}>back</button>

      <button id="selectionPrevBtn" className="selection-nav-btn selection-prev" type="button" aria-label="prev" style={{ display: 'none', opacity: 0 }}>&lt;</button>
      <button id="selectionNextBtn" className="selection-nav-btn selection-next" type="button" aria-label="next" style={{ display: 'none', opacity: 0 }}>&gt;</button>
    </>
  );
}

export default App;
