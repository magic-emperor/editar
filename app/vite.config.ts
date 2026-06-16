import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'

// COOP/COEP headers are required for SharedArrayBuffer (PDFium WASM threading).
// Production hosting must send the same two headers.
const crossOriginIsolationHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
}

export default defineConfig({
  plugins: [react(), wasm()],
  server: { headers: crossOriginIsolationHeaders },
  preview: { headers: crossOriginIsolationHeaders },
  worker: {
    format: 'es',
    plugins: () => [wasm()],
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        // Function form required by Rolldown (Vite 8)
        manualChunks: (id: string) => {
          if (id.includes('@hyzyla/pdfium')) return 'pdfium'
          if (id.includes('pdf-lib'))        return 'pdflib'
          if (id.includes('pdfjs-dist'))     return 'pdfjs'
          if (id.includes('tesseract.js'))   return 'tesseract'
        },
      },
    },
  },
  optimizeDeps: {
    // WASM-bearing package must not be pre-bundled by esbuild
    exclude: ['@hyzyla/pdfium'],
  },
})
