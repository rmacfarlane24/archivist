import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, existsSync } from 'fs'

// Plugin to copy standalone HTML files
function copyHtmlFiles() {
  return {
    name: 'copy-html-files',
    writeBundle() {
      const htmlFiles = [
        'signin.html',
        'auth-confirm.html', 
        'payment-success.html',
        'payment-cancel.html',
        'subscription.html',
        'email-confirmation-page.html'
      ];
      
      htmlFiles.forEach(file => {
        const srcPath = resolve(__dirname, 'app', file);
        const destPath = resolve(__dirname, 'app/dist', file);
        
        if (existsSync(srcPath)) {
          copyFileSync(srcPath, destPath);
          console.log(`Copied ${file} to dist folder`);
        }
      });
    }
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), copyHtmlFiles()],
    base: './',
    root: 'app',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      watch: mode === 'development' ? {} : null,
      // Ensure environment variables are embedded in production builds
      rollupOptions: {
        output: {
          // Preserve environment variables in the build
          manualChunks: undefined
        }
      }
    },
    // Environment variable configuration for both development and production
    define: {
      // Make all REACT_APP_ prefixed environment variables available
      'process.env.REACT_APP_SUPABASE_URL': JSON.stringify(env.REACT_APP_SUPABASE_URL),
      'process.env.REACT_APP_SUPABASE_ANON_KEY': JSON.stringify(env.REACT_APP_SUPABASE_ANON_KEY),
      // Add any other REACT_APP_ variables that might be needed
      'process.env.NODE_ENV': JSON.stringify(mode),
      // Ensure these are always available
      'process.env.MODE': JSON.stringify(mode)
    }
  }
}) 