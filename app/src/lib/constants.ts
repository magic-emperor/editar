// Phase 0 finding: 150 DPI scores 73% tokenF1 (17 points below the 90% gate);
// 200 DPI is the minimum that passes. Used by the Phase 2 OCR rasterization path.
export const OCR_DPI = 200
export const OCR_SCALE = OCR_DPI / 72

// Viewer zoom steps (CSS-preview first, sharp re-render after debounce)
export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5] as const
export const DEFAULT_ZOOM = 1

// Render-quality scale at 100% zoom (1.5 ≈ 108 DPI; crisp on standard displays
// without the memory cost of full retina rendering on every page)
export const BASE_RENDER_SCALE = 1.5

// Thumbnails render once at this scale and are kept for the session
export const THUMB_SCALE = 0.15

// Virtualization: render viewport ± this many pages
export const RENDER_MARGIN_PAGES = 2

// Worker render queue: max concurrent page renders
export const MAX_CONCURRENT_RENDERS = 2

// Text layer (Phase 2): a page whose native text layer has fewer than this many
// non-space characters is treated as image-only → OCR fallback.
export const EMPTY_TEXT_THRESHOLD = 8

// OCR word boxes below this tesseract confidence (0–100) are flagged for review.
export const OCR_LOW_CONFIDENCE = 70

// Top-20 world languages for OCR (by global speaker count).
// English is self-hosted; all others are lazy-downloaded from the Tesseract CDN
// on first use and cached by the browser thereafter.
export const OCR_LANGUAGES = [
  { code: 'eng', label: 'English'     },
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'hin', label: 'Hindi'       },
  { code: 'spa', label: 'Spanish'     },
  { code: 'fra', label: 'French'      },
  { code: 'ara', label: 'Arabic'      },
  { code: 'ben', label: 'Bengali'     },
  { code: 'rus', label: 'Russian'     },
  { code: 'por', label: 'Portuguese'  },
  { code: 'urd', label: 'Urdu'        },
  { code: 'ind', label: 'Indonesian'  },
  { code: 'deu', label: 'German'      },
  { code: 'jpn', label: 'Japanese'    },
  { code: 'kor', label: 'Korean'      },
  { code: 'tur', label: 'Turkish'     },
  { code: 'ita', label: 'Italian'     },
  { code: 'tha', label: 'Thai'        },
  { code: 'vie', label: 'Vietnamese'  },
  { code: 'pol', label: 'Polish'      },
  { code: 'nld', label: 'Dutch'       },
] as const

export type OcrLanguageCode = typeof OCR_LANGUAGES[number]['code']

// Argos Translate language codes (ISO 639-1) for document translation.
// 'auto' triggers langdetect on the server; all others are passed directly.
export const TRANSLATE_SOURCE_LANGS = [
  { code: 'auto', label: 'Auto-detect'            },
  { code: 'zh',   label: 'Chinese (Simplified)'   },
  { code: 'zt',   label: 'Chinese (Traditional)'  },
  { code: 'ar',   label: 'Arabic'                 },
  { code: 'hi',   label: 'Hindi'                  },
  { code: 'es',   label: 'Spanish'                },
  { code: 'fr',   label: 'French'                 },
  { code: 'de',   label: 'German'                 },
  { code: 'ru',   label: 'Russian'                },
  { code: 'pt',   label: 'Portuguese'             },
  { code: 'ja',   label: 'Japanese'               },
  { code: 'ko',   label: 'Korean'                 },
  { code: 'it',   label: 'Italian'                },
  { code: 'nl',   label: 'Dutch'                  },
  { code: 'tr',   label: 'Turkish'                },
  { code: 'vi',   label: 'Vietnamese'             },
  { code: 'id',   label: 'Indonesian'             },
  { code: 'th',   label: 'Thai'                   },
  { code: 'pl',   label: 'Polish'                 },
  { code: 'uk',   label: 'Ukrainian'              },
  { code: 'fa',   label: 'Persian'                },
] as const

export const TRANSLATE_TARGET_LANGS = [
  { code: 'en', label: 'English'                },
  { code: 'zh', label: 'Chinese (Simplified)'   },
  { code: 'fr', label: 'French'                 },
  { code: 'es', label: 'Spanish'                },
  { code: 'de', label: 'German'                 },
  { code: 'ru', label: 'Russian'                },
  { code: 'pt', label: 'Portuguese'             },
  { code: 'ar', label: 'Arabic'                 },
  { code: 'ja', label: 'Japanese'               },
  { code: 'it', label: 'Italian'                },
] as const
