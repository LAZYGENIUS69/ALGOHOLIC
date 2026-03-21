import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    base: '/app/',
    plugins: [react()],
    server: {
        proxy: {
            '/health': {
                target: 'http://localhost:3001',
                changeOrigin: true
            },
            '/api': {
                target: 'http://localhost:3001',
                changeOrigin: true
            }
        },
    },
});
