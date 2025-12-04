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
      rollupOptions: {
        output: {
          manualChunks: undefined
        }
      }
    },
    // Make environment variables available to the client code
    define: {
      // Use import.meta.env format for Vite
      'import.meta.env.REACT_APP_SUPABASE_URL': JSON.stringify(env.REACT_APP_SUPABASE_URL),
      'import.meta.env.REACT_APP_SUPABASE_ANON_KEY': JSON.stringify(env.REACT_APP_SUPABASE_ANON_KEY),
      'import.meta.env.NODE_ENV': JSON.stringify(mode),
      'import.meta.env.MODE': JSON.stringify(mode)
    },
    // Also configure envPrefix to allow REACT_APP_ variables
    envPrefix: ['VITE_', 'REACT_APP_']
  }
}) 