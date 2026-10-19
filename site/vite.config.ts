import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// O site é publicado em https://jana-projetos.github.io/portal-terceiros/
export default defineConfig({
  base: '/portal-terceiros/',
  plugins: [react()],
});
