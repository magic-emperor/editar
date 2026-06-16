import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/tokens.css'
import './styles/editFonts.css'
import { FileStoreProvider } from './lib/fileStore.tsx'
import { EditStoreProvider } from './lib/editStore.tsx'
import { AIStoreProvider } from './lib/aiStore.tsx'
import { AnnotationStoreProvider } from './lib/annotationStore.tsx'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FileStoreProvider>
      <EditStoreProvider>
        <AIStoreProvider>
          <AnnotationStoreProvider>
            <App />
          </AnnotationStoreProvider>
        </AIStoreProvider>
      </EditStoreProvider>
    </FileStoreProvider>
  </StrictMode>,
)
