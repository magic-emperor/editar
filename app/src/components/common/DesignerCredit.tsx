import styles from './DesignerCredit.module.css'

export function DesignerCredit({ className }: { className?: string }) {
  return (
    <div className={`${styles.wrap} ${className || ''}`}>
      <span className={styles.designerBadge}>
        <span className={styles.designerSparkle} aria-hidden>✨</span>
        <span className={styles.designerText}>Designed and Developed by</span>
        <a
          href="https://faizzanportfolio.netlify.app/"
          target="_blank"
          rel="noopener noreferrer"
          className={styles.designerLink}
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
    </div>
  )
}
