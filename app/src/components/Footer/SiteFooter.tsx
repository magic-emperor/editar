import styles from './SiteFooter.module.css'

export function SiteFooter() {
  const year = new Date().getFullYear()

  return (
    <footer className={styles.footer}>
      {/* ── Top section: 4-column editorial grid ── */}
      <div className={styles.top}>
        {/* Col 1 — Brand */}
        <div className={styles.brandCol}>
          <div className={styles.brandLogo}>
            <span className={styles.logoText}>E D I T A R</span>
          </div>
          <p className={styles.brandTagline}>
            A little simpler. A lot more private.
          </p>
          <p className={styles.brandSub}>
            Thoughtfully made for the way<br />you work.
          </p>
        </div>

        {/* Col 2 — Less, But Better */}
        <div className={styles.col}>
          <span className={styles.colHeading}>LESS, BUT BETTER</span>
          <ul className={styles.colList}>
            <li>Less friction</li>
            <li>More focus</li>
            <li>More done</li>
          </ul>
        </div>

        {/* Col 3 — Private by Design */}
        <div className={styles.col}>
          <span className={styles.colHeading}>PRIVATE BY DESIGN</span>
          <p className={styles.colBody}>
            Your ideas. Your space.<br />
            A calmer place to make<br />
            things happen.
          </p>
        </div>

        {/* Col 4 — Make Room */}
        <div className={styles.col}>
          <span className={styles.colHeading}>MAKE ROOM FOR WHAT MATTERS</span>
          <p className={styles.colQuote}>
            Less friction.<br />
            More done.
          </p>
        </div>
      </div>

      {/* ── Wordmark: spaced letters spanning full width ── */}
      <div className={styles.wordmarkWrap} aria-hidden>
        <div className={styles.wordmark}>
          <span>E</span>
          <span>D</span>
          <span>I</span>
          <span>T</span>
          <span>A</span>
          <span>R</span>
        </div>
      </div>

      {/* ── Bottom strip ── */}
      <div className={styles.bottom}>
        <span className={styles.copyright}>
          © {year} EDITAR. All rights reserved.
        </span>
        <span className={styles.credit}>
          Designed and Developed by{' '}
          <a
            href="https://faizzanportfolio.netlify.app/"
            target="_blank"
            rel="noopener noreferrer"
            className={styles.creditLink}
          >
            Faizan Khan
          </a>
          <span
            className={styles.testerSecret}
            title="Tested with care by Aien"
            aria-label="Tested by Aien"
          >
            <span className={styles.testerDot}>·</span>
            <span className={styles.testerName}>Tested with care by <strong>Aien</strong></span>
          </span>
        </span>
        <span className={styles.motto}>Less noise. More possibility.</span>
      </div>
    </footer>
  )
}
