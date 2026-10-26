import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'

// 多页 demo:index.html 用 history 模式,/hash.html 用 hash 模式
export default defineConfig({
  resolve: {
    alias: {
      '@mini': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        hash: fileURLToPath(new URL('./hash.html', import.meta.url)),
      },
    },
  },
})