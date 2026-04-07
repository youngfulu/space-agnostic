import { useEffect, useRef } from 'react';

/**
 * React shell: DOM structure for legacy script.js (canvas grid, filters, about).
 */
function App() {
  const scriptsLoaded = useRef(false);

  useEffect(() => {
    if (scriptsLoaded.current) return;
    scriptsLoaded.current = true;

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
    loadScript(scriptBase + 'about.js')
      .then(() => loadScript(scriptBase + 'script.js'))
      .catch((err) => console.error('Script load error:', err));
  }, []);

  return (
    <>
      <div id="loadingIndicator" className="loading-indicator">
        <div className="loading-indicator-inner" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
          <div id="loadingText" className="loading-text"></div>
          <div
            id="loadingProgressBar"
            className="loading-progress-bar"
            aria-hidden="true"
            style={{
              height: 2.5,
              minHeight: 2.5,
              width: 174,
              background: 'rgba(255,255,255,0.4)',
              border: '1px solid rgba(255,255,255,0.4)',
              borderRadius: 2,
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {/* Width is set ONLY by script.js (updateLoadingProgressBar). Do not set width here or React will overwrite it on re-render. */}
            <div
              id="loadingProgressBarFill"
              className="loading-progress-bar-fill"
              style={{ height: '100%', background: 'rgba(255,255,255,0.4)', borderRadius: 2 }}
            />
          </div>
        </div>
      </div>

      <canvas id="canvas"></canvas>

      <div id="aboutText" className="about-text" style={{ display: 'none' }}></div>

      <div id="projectAboutText" className="project-about-text" style={{ display: 'none' }}>
        <div id="projectName" className="project-name"></div>
        <div id="projectInfo" className="project-info"></div>
        <div id="projectMore" className="project-more" style={{ display: 'none' }}></div>
      </div>

      <div id="filterButtons" className="filter-buttons">
        <span className="filter-button" data-tag="stage">stage design</span>
        <span className="filter-button" data-tag="install">installation</span>
        <span className="filter-button" data-tag="tech">technical solutions</span>
        <span className="filter-button" data-tag="concept">concepts</span>
        <span className="filter-button" data-tag="spatial">spatial design</span>
        <span className="filter-button" id="weAreButton">we are</span>
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
          <div className="mobile-nav-label" data-category="we-are">we are</div>
          <div className="mobile-nav-label" data-category="stage">stage design</div>
          <div className="mobile-nav-label" data-category="install">installation</div>
          <div className="mobile-nav-label" data-category="tech">technical solutions</div>
          <div className="mobile-nav-label" data-category="spatial">spatial design</div>
        </div>
      </div>

      <div id="mobileCategoryContent" className="mobile-category-content">
        <button id="mobileCategoryBack" className="mobile-category-back">back</button>
        <div className="mobile-category-content-inner">
          <div id="mobileCategoryTitle" className="mobile-category-title"></div>
          <div id="mobileCategoryBody"></div>
        </div>
      </div>

      <button id="selectionPrevBtn" className="selection-nav-btn selection-prev" type="button" aria-label="prev" style={{ display: 'none', opacity: 0 }}>&lt;</button>
      <button id="selectionNextBtn" className="selection-nav-btn selection-next" type="button" aria-label="next" style={{ display: 'none', opacity: 0 }}>&gt;</button>
    </>
  );
}

export default App;
