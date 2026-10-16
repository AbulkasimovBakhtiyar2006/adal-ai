import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Иконки PWA генерируются из public/kazakhstan-emblem.jpg командой `npm run icons`
// и хранятся в public/ вместе с исходником. Для maskable- и apple-иконок фон
// фирменный, чтобы на телефоне вокруг значка не было белой рамки.
const brandBackground = { background: '#ffffff', fit: 'contain' } as const

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: brandBackground },
    apple: { ...minimal2023Preset.apple, resizeOptions: brandBackground },
  },
  images: ['public/kazakhstan-emblem.jpg'],
})
