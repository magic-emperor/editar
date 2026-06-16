import { useEffect, useRef } from 'react'
import styles from './SearchBar.module.css'

interface Props {
  query:       string
  onQuery:     (q: string) => void
  matchCount:  number
  activeIndex: number          // 0-based; -1 when none
  onPrev:      () => void
  onNext:      () => void
  onClose:     () => void
  scanned:     number          // pages whose text is loaded
  total:       number          // total pages
}

export function SearchBar({
  query, onQuery, matchCount, activeIndex, onPrev, onNext, onClose, scanned, total,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [])

  const stillLoading = scanned < total

  return (
    <div className={styles.bar} role="search">
      <input
        ref={inputRef}
        className={styles.input}
        value={query}
        onChange={e => onQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? onPrev() : onNext() }
          else if (e.key === 'Escape') { e.preventDefault(); onClose() }
        }}
        placeholder="Find in document"
        aria-label="Find in document"
      />

      <span className={styles.count} aria-live="polite">
        {query.trim() === ''
          ? (stillLoading ? `indexing ${scanned}/${total}` : '')
          : matchCount === 0
            ? (stillLoading ? `indexing ${scanned}/${total}…` : 'No results')
            : `${activeIndex + 1} of ${matchCount}`}
      </span>

      <button className={styles.navBtn} onClick={onPrev}
        disabled={matchCount === 0} aria-label="Previous match">↑</button>
      <button className={styles.navBtn} onClick={onNext}
        disabled={matchCount === 0} aria-label="Next match">↓</button>
      <button className={styles.closeBtn} onClick={onClose} aria-label="Close find">×</button>
    </div>
  )
}
