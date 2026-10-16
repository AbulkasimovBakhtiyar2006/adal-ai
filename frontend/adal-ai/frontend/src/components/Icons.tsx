/** Небольшой набор SVG-иконок. Декоративные: подпись даёт текст или aria-label кнопки. */
import type { SVGProps } from 'react'

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    />
  )
}

export const PlusIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const SearchIcon = () => <Icon><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></Icon>
export const MenuIcon = () => <Icon><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16M13 9h4M13 13h4" /></Icon>
export const BookIcon = () => <Icon><path d="M12 5v15M3 4h5a4 4 0 0 1 4 3 4 4 0 0 1 4-3h5v15h-5a4 4 0 0 0-4 2 4 4 0 0 0-4-2H3V4Z" /></Icon>
export const BuildingIcon = () => <Icon><path d="m3 8 9-5 9 5H3ZM5 10v8M10 10v8M14 10v8M19 10v8M3 21h18" /></Icon>
export const LeafIcon = () => <Icon><path d="M20 3C8 2 3 7 5 14s13 7 15-11ZM4 21 16 9" /></Icon>
export const ChatIcon = () => <Icon><path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0ZM7 10h10M7 14h6" /></Icon>
export const HomeIcon = () => <Icon><path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7" /></Icon>

export const MicIcon = () => <Icon><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></Icon>
export const PhoneIcon = () => <Icon><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 10a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.7 2Z" /></Icon>
export const SpeakerIcon = () => <Icon><path d="m11 5-6 4H2v6h3l6 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></Icon>

export const SendIcon = () => (
  <Icon>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
)

export const DotsIcon = () => (
  <Icon>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </Icon>
)

export const ExternalIcon = () => (
  <Icon width="14" height="14">
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Icon>
)

export const QuestionIcon = () => (
  <Icon width="18" height="18">
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01" />
  </Icon>
)

export const InfoIcon = () => (
  <Icon width="18" height="18">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 7.5h.01" />
  </Icon>
)

export const AlertIcon = () => (
  <Icon width="18" height="18">
    <path d="M12 3 2 20h20L12 3Z" />
    <path d="M12 10v4M12 17h.01" />
  </Icon>
)

export const RetryIcon = () => (
  <Icon width="18" height="18">
    <path d="M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5" />
  </Icon>
)

export const SettingsIcon = () => <Icon><path d="M4 6h16M4 12h16M4 18h16" /><rect x="7" y="4" width="3" height="4" rx="1" fill="var(--surface)" /><rect x="14" y="10" width="3" height="4" rx="1" fill="var(--surface)" /><rect x="8" y="16" width="3" height="4" rx="1" fill="var(--surface)" /></Icon>

export const SunIcon = () => <Icon><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" /></Icon>
export const MoonIcon = () => <Icon><path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z" /></Icon>
