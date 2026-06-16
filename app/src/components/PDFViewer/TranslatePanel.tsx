import { useState, useEffect, useCallback } from 'react'
import { translatePageBlocks } from '../../lib/translator'
import type { TranslationBlock, TranslationMeta } from '../../lib/translator'
import styles from './TranslatePanel.module.css'

interface Props {
  docId:     string
  bytes:     Uint8Array
  pageCount: number
  currentPage: number
  onClose:   () => void
  onPageTranslated?: (pageIndex: number, blocks: TranslationBlock[], meta: TranslationMeta) => void
}

type Status = 'idle' | 'translating' | 'ready' | 'error'

const LANG_NAMES: Record<string, string> = {
  zh: 'Chinese (Simplified)', zt: 'Chinese (Traditional)',
  ja: 'Japanese',  ko: 'Korean',   ar: 'Arabic',
  hi: 'Hindi',     bn: 'Bengali',  ur: 'Urdu',
  ru: 'Russian',   fr: 'French',   de: 'German',  es: 'Spanish',
  pt: 'Portuguese', it: 'Italian', nl: 'Dutch',   pl: 'Polish',
  tr: 'Turkish',   vi: 'Vietnamese', th: 'Thai',  id: 'Indonesian',
  uk: 'Ukrainian', fa: 'Persian',  he: 'Hebrew',  sv: 'Swedish',
}

export function TranslatePanel({
  docId: _docId, bytes, currentPage, onClose, onPageTranslated,
}: Props) {
  const [status,       setStatus]       = useState<Status>('idle')
  const [translated,   setTranslated]   = useState('')
  const [detectedLang, setDetectedLang] = useState('')
  const [errorMsg,     setErrorMsg]     = useState('')
  const [forPage,      setForPage]      = useState(-1)

  const runTranslation = useCallback(async (pageIdx: number) => {
    setStatus('translating')
    setTranslated('')
    setErrorMsg('')
    setDetectedLang('')
    setForPage(pageIdx)

    const result = await translatePageBlocks(bytes, pageIdx, 'en')

    if (result.error) {
      const msg = result.error
      let display = msg
      if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_CONNECTION_REFUSED')) {
        display = 'Translation server not reachable. Start the local server (start.bat / start.sh) and try again.'
      } else if (msg.includes('mixed content') || msg.includes('blocked') || msg.includes('insecure')) {
        display = 'Translation requires running from the local dev server (http://localhost:5173), not a deployed URL.'
      } else if (msg.includes('TimeoutError') || msg.includes('AbortError') || msg.includes('timeout')) {
        display = 'Translation timed out. Check your internet connection and retry.'
      }
      setErrorMsg(display)
      setStatus('error')
      return
    }

    const summaryText = result.blocks.map(b => b.translated).join('\n')
    setTranslated(summaryText)
    setDetectedLang(result.meta.detected_lang)
    setStatus('ready')
    onPageTranslated?.(pageIdx, result.blocks, result.meta)
  }, [bytes, onPageTranslated])

  // 800ms debounce: wait for the user to settle on a page before hitting the server
  useEffect(() => {
    const timer = setTimeout(() => runTranslation(currentPage), 800)
    return () => clearTimeout(timer)
  }, [currentPage, runTranslation])

  const langLabel = LANG_NAMES[detectedLang] ?? detectedLang

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span className={styles.title}>
          {status === 'translating' ? `Translating page ${forPage + 1}…` :
           status === 'ready'       ? `Page ${forPage + 1} — ${langLabel} → English` :
           status === 'error'       ? `Page ${forPage + 1} — Translation error` :
           'Translate to English'}
        </span>
        <div className={styles.actions}>
          {status === 'ready' && (
            <button
              className={styles.copyBtn}
              onClick={() => navigator.clipboard.writeText(translated)}
              title="Copy translation to clipboard"
            >⎘ Copy</button>
          )}
          {status === 'error' && (
            <button className={styles.retryBtn} onClick={() => runTranslation(currentPage)}>
              Retry
            </button>
          )}
          <button className={styles.closeBtn} onClick={onClose} title="Close translate panel">✕</button>
        </div>
      </div>

      <div className={styles.body}>
        {status === 'translating' && (
          <p className={styles.statusMsg}>Translating page {forPage + 1}…</p>
        )}
        {status === 'error' && (
          <p className={styles.errorMsg}>{errorMsg}</p>
        )}
        {status === 'ready' && (
          <p className={styles.text}>{translated}</p>
        )}
        {status === 'idle' && (
          <p className={styles.statusMsg}>Ready to translate.</p>
        )}
      </div>
    </div>
  )
}
