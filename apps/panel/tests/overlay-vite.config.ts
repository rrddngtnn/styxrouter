import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
export default defineConfig({ plugins: [react()], base: '/panel/', cacheDir: process.env.TMPDIR + '/provider-overlay-vite-cache' });
