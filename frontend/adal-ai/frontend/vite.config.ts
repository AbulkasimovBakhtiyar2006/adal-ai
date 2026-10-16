import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { mockApiMiddleware } from './dev/mockApi.ts'

// Адрес настоящего backend для разработки, например http://localhost:8000.
// Настоящий backend используется по умолчанию. Mock включается только явно.
// Переменная читается только здесь, в Node, и в сборку не попадает.
const mockEnabled = process.env.ADAL_MOCK_API === '1'
const apiTarget = mockEnabled ? undefined : (process.env.ADAL_API_TARGET || 'http://127.0.0.1:8000')

/** Mock API для разработки интерфейса без backend. Не входит в production-сборку. */
function devMockApi(): Plugin {
  return {
    name: 'adal-dev-mock-api',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.warn('[adal] /api/* обслуживает dev mock API: ответы тестовые.')
      server.middlewares.use(mockApiMiddleware())
    },
    configurePreviewServer(server) {
      server.config.logger.warn('[adal] /api/* обслуживает dev mock API: ответы тестовые.')
      server.middlewares.use(mockApiMiddleware())
    },
  }
}

/**
 * Content-Security-Policy для собранной страницы. В dev-режиме не добавляется:
 * Vite использует inline-скрипты для горячей перезагрузки.
 */
function contentSecurityPolicy(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self' https://accounts.google.com/gsi/client",
    "style-src 'self' https://accounts.google.com/gsi/style",
    "img-src 'self' data:",
    "connect-src 'self' https://accounts.google.com/gsi/",
    "frame-src 'self' https://accounts.google.com/gsi/",
    "manifest-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'adal-csp',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: policy }, injectTo: 'head-prepend' }]
    },
  }
}

const serverHeaders = process.env.ADAL_BACKEND_API_KEY
  ? { Authorization: `Bearer ${process.env.ADAL_BACKEND_API_KEY}` }
  : undefined
const proxy = apiTarget ? { '/api': { target: apiTarget, headers: serverHeaders, timeout: 125_000 } } : undefined

export default defineConfig({
  plugins: [
    react(),
    ...(apiTarget ? [] : [devMockApi()]),
    contentSecurityPolicy(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'script-defer',
      manifest: {
        name: 'Adal AI',
        short_name: 'Adal AI',
        description:
          'Справочник-навигатор по внутренней политике и идеологической работе Казахстана. ' +
          'Қазақстанның ішкі саясаты мен идеологиялық жұмысы бойынша анықтамалық-навигатор.',
        lang: 'ru',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#2855a6',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        // Кэшируется только статика интерфейса. Ответы /api/* (история, сообщения)
        // в кэш не попадают: правил runtimeCaching нет, запросы идут в сеть.
        globPatterns: ['**/*.{js,css,html,svg,png,jpg,ico}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/api(?:\/|$)/,
          /^\/admin(?:\/|$)/,
          /^\/(?:docs|redoc|openapi\.json|health|ready)(?:\/|$)/,
          /^\/webhooks\//,
        ],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { proxy },
  preview: { proxy },
})
