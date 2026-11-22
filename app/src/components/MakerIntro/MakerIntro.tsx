import { useState, useEffect, useRef } from 'react'
import styles from './MakerIntro.module.css'

export function MakerIntro({ onComplete }: { onComplete: () => void }) {
  const [percent, setPercent] = useState(0)
  const [exiting, setExiting] = useState(false)
  const rafRef = useRef<number | null>(null)
  const completedRef = useRef(false)

  const handleEnter = () => {
    if (completedRef.current) return
    completedRef.current = true
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    setExiting(true)
    setTimeout(() => {
      onComplete()
    }, 650)
  }

  useEffect(() => {
    const startTime = performance.now()
    const duration = 3000 // 3 seconds

    function tick(now: number) {
      const elapsed = now - startTime
      const p = Math.min(elapsed / duration, 1)
      const n = Math.round((1 - Math.pow(1 - p, 1.5)) * 100)
      setPercent(n)

      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setTimeout(() => {
          handleEnter()
        }, 150)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const status =
    percent < 45
      ? 'Preparing your workspace'
      : percent < 94
      ? 'Keeping your files yours'
      : 'Ready. Let’s make room.'

  return (
    <main id="intro" className={`${styles.introRoot} ${exiting ? styles.exit : ''}`}>
      <header className={styles.header}>
        <strong>EDITAR</strong>
        <span>A NOTE BEFORE WE BEGIN</span>
      </header>

      <section className={styles.section}>
        <p className={styles.eyebrow}>THE MAKER BEHIND EDITAR</p>
        <div className={styles.portrait}>
          <img
            src="/maker.jpg"
            alt="Faizan Khan"
            onError={(e) => {
              ;(e.currentTarget as HTMLImageElement).src =
                'https://avatars.githubusercontent.com/u/127963731?v=4'
            }}
          />
        </div>
        <h1 className={styles.title}>
          Faizan <em>Khan.</em>
        </h1>
        <p className={styles.bio}>
          Software Engineer. Privacy-first builder.
          <br />
          Crafting thoughtful tools for the everyday.
        </p>
        <p className={styles.place}>BENGALURU, INDIA · BUILDING FOR EVERYWHERE</p>
        <p className={styles.testerCredit}>
          Tested with care by <strong>Aien</strong>
        </p>
        <div className={styles.loading}>
          <div className={styles.meta}>
            <span id="status">{status}</span>
            <span id="percent">{String(percent).padStart(2, '0')}%</span>
          </div>
          <div className={styles.track}>
            <div className={styles.bar} id="bar" style={{ width: `${percent}%` }} />
          </div>
          <p className={styles.note}>YOUR FILES. YOUR BROWSER. ALWAYS YOURS.</p>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>
          <i className={styles.dot} />
          MADE WITH INTENTION
        </span>
        <button
          id="skip"
          className={styles.skipBtn}
          onClick={handleEnter}
          aria-label="Skip introduction and enter EDITAR"
        >
          ENTER EDITAR
        </button>
        <span>LESS FRICTION. MORE DONE.</span>
      </footer>
    </main>
  )
}
