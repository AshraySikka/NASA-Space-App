import { Flame, FlaskConical, Library as LibraryIcon, Map as MapIcon, MessageSquareText } from 'lucide-react'
import { lazy, Suspense, useEffect, useLayoutEffect } from 'react'
import { About } from './components/About'
import { ChatDock } from './components/ChatDock'
import { Controls } from './components/Controls'
import { EvidencePanel } from './components/EvidencePanel'
import { ResultBanner } from './components/ResultBanner'
import { Simulator } from './components/Simulator'
import { SourcesDrawer } from './components/SourcesDrawer'
import { TopBar } from './components/TopBar'
import { Tour } from './components/Tour'
import { useApp, type MobileTab, type RightTab } from './store'

const FlammabilityMap = lazy(() => import('./components/FlammabilityMap'))
const Library = lazy(() => import('./components/Library'))

const RIGHT: { id: RightTab; label: string; icon: typeof Flame }[] = [
  { id: 'evidence', label: 'Evidence', icon: FlaskConical },
  { id: 'map', label: 'Map', icon: MapIcon },
  { id: 'library', label: 'Library', icon: LibraryIcon },
]
const MOBILE: { id: MobileTab; label: string; icon: typeof Flame }[] = [{ id: 'chat', label: 'Ask', icon: MessageSquareText }, { id: 'simulator', label: 'Simulator', icon: Flame }, ...RIGHT]

function Skeleton() {
  return (
    <div className="app-skel" aria-busy="true" aria-label="Loading NASA data">
      <div className="skeleton" />
      <div className="skeleton tall" />
      <div className="skeleton" />
    </div>
  )
}

export default function App() {
  const { data, dataError, prefs, chatOpen, rightTab, mobileTab, toast } = useApp()
  const init = useApp((s) => s.init)
  const set = useApp((s) => s.set)
  useEffect(() => {
    void init()
  }, [init])
  // layout effect: the theme must be on <html> before children read CSS variables (3D scene background)
  useLayoutEffect(() => {
    const el = document.documentElement
    el.dataset.theme = prefs.theme
    el.dataset.accent = prefs.accent
    el.dataset.density = prefs.density
    el.dataset.motion = prefs.reduceMotion ? 'reduced' : 'full'
  }, [prefs])

  if (dataError)
    return (
      <main className="fatal" role="alert">
        <h1>Data not loaded</h1>
        <p>{dataError}</p>
        <p>This app only shows real NASA data from <code>data/processed</code>. It has no built-in sample data to fall back on.</p>
      </main>
    )

  const tabPanel = (
    <Suspense fallback={<div className="skeleton tall" aria-label="Loading" />}>
      {rightTab === 'evidence' && <EvidencePanel />}
      {rightTab === 'map' && <FlammabilityMap />}
      {rightTab === 'library' && <Library />}
    </Suspense>
  )

  return (
    <div className="app" data-mobile={mobileTab} data-chat={chatOpen ? 'open' : 'closed'}>
      <a className="skip" href="#main">
        Skip to simulator
      </a>
      <TopBar />
      {!data ? (
        <Skeleton />
      ) : (
        <main className="zones" id="main">
          <div className="zone zone-chat" hidden={!chatOpen && undefined} data-zone="chat">
            <ChatDock />
          </div>
          <div className="zone zone-center" data-zone="simulator">
            <Simulator />
            <ResultBanner />
            <Controls />
          </div>
          <div className="zone zone-right" data-zone="right">
            <div className="tabs" role="tablist" aria-label="Evidence views" data-tour="tabs">
              {RIGHT.map((t) => (
                <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={rightTab === t.id} aria-controls="right-panel" className={rightTab === t.id ? 'tab on' : 'tab'} onClick={() => set({ rightTab: t.id })}>
                  <t.icon size={14} aria-hidden /> {t.label}
                </button>
              ))}
            </div>
            <div className="panel tabpanel" role="tabpanel" id="right-panel" aria-labelledby={`tab-${rightTab}`}>
              {tabPanel}
            </div>
          </div>
        </main>
      )}
      <footer className="footer" data-panel="footer">
        <span data-disclaimer="footer">Evidence tool, not a safety certification.</span> <em>Claude and Gemini help retrieve and draft answers; backend code verifies every claim against its source. Built for NASA Space Apps 2026. Not affiliated with NASA.</em>
      </footer>
      <nav className="mobile-tabs" aria-label="Sections">
        {MOBILE.map((t) => (
          <button key={t.id} type="button" className={mobileTab === t.id ? 'on' : ''} aria-current={mobileTab === t.id ? 'page' : undefined} onClick={() => set({ mobileTab: t.id, ...(t.id !== 'chat' && t.id !== 'simulator' ? { rightTab: t.id } : {}), ...(t.id === 'chat' ? { chatOpen: true } : {}) })}>
            <t.icon size={17} aria-hidden />
            {t.label}
          </button>
        ))}
      </nav>
      <SourcesDrawer />
      <About />
      <Tour />
      <div className="toast" role="status" aria-live="polite">
        {toast}
      </div>
    </div>
  )
}
