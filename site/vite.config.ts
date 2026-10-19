import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O site é publicado em https://jana-projetos.github.io/portal-terceiros/
export default defineConfig({
  base: '/portal-terceiros/',
  plugins: [react()],
  // supabase-js + React ficam num pacote só (~145 KB compactado), o que é aceitável para o portal.
  build: { chunkSizeWarningLimit: 700 },
});
