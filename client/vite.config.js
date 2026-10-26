import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // The iOS/Android apps can't use relative /api URLs, so a mobile build must know where the API lives.
  if (mode === 'mobile' && !/^https:\/\//.test(env.VITE_API_URL || '')) {
    throw new Error('Mobile build needs VITE_API_URL=https://<your-app>.vercel.app (put it in client/.env.mobile)');
  }
  return {
    plugins: [react()],
    server: {
      host: true,
      proxy: { '/api': 'http://localhost:3001' },
    },
  };
});
