import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Иконки PWA генерируются из public/logo.svg командой `npm run icons`
// и хранятся в public/ вместе с исходником. Для maskable- и apple-иконок фон
// фирменный, чтобы на телефоне вокруг значка не было белой рамки.
const brandBackground = { background: '#087f7b', fit: 'contain' } as const

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: brandBackground },
    apple: { ...minimal2023Preset.apple, resizeOptions: brandBackground },
  },
  images: ['public/logo.svg'],
})
