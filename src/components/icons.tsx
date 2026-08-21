import type { ReactNode, SVGProps } from "react";

export type IconName =
  | "upload"
  | "folder"
  | "plus"
  | "download"
  | "trash"
  | "copy"
  | "mic"
  | "stop"
  | "pause"
  | "play"
  | "search"
  | "save"
  | "login"
  | "logout"
  | "refresh"
  | "file"
  | "check"
  | "x"
  | "notebook"
  | "arrow"
  | "chart"
  | "user"
  | "mail"
  | "lock"
  | "paste"
  | "clear"
  | "sun"
  | "moon"
  | "eye"
  | "eyeOff"
  | "calculator"
  | "reagents"
  | "beaker"
  | "edit";

const PATHS: Record<IconName, ReactNode> = {
  upload: <><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 20h16" /></>,
  folder: <><path d="M3 7h6l2 2h10v11H3z" /><path d="M3 7V5h6l2 2" /></>,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  download: <><path d="M12 4v12" /><path d="M7 11l5 5 5-5" /><path d="M4 20h16" /></>,
  trash: <><path d="M4 7h16" /><path d="M9 7V5h6v2" /><path d="M6 7l1 13h10l1-13" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="1.5" /><path d="M6 16H5a1.5 1.5 0 0 1-1.5-1.5v-11A1.5 1.5 0 0 1 5 2h11A1.5 1.5 0 0 1 17.5 3.5V5" /></>,
  mic: <><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="1.5" />,
  pause: <><path d="M8 5v14" /><path d="M16 5v14" /></>,
  play: <path d="M8 5v14l11-7z" />,
  search: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4-4" /></>,
  save: <><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h8" /><path d="M8 20v-6h8v6" /></>,
  login: <><path d="M10 12h10" /><path d="M16 8l4 4-4 4" /><path d="M14 4H6v16h8" /></>,
  logout: <><path d="M14 12H4" /><path d="M8 8l-4 4 4 4" /><path d="M10 4h8v16h-8" /></>,
  refresh: <><path d="M4 12a8 8 0 0 1 13.5-5.5L20 9" /><path d="M20 4v5h-5" /><path d="M20 12a8 8 0 0 1-13.5 5.5L4 15" /><path d="M4 20v-5h5" /></>,
  file: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></>,
  check: <path d="M5 12l5 5 9-9" />,
  x: <><path d="M6 6l12 12" /><path d="M18 6L6 18" /></>,
  notebook: <><path d="M6 3h12v18H6z" /><path d="M10 3v18" /><path d="M13 8h3" /><path d="M13 12h3" /></>,
  arrow: <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
  chart: <><path d="M4 19h16" /><path d="M7 16V9" /><path d="M12 16V5" /><path d="M17 16v-7" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M4 7l8 6 8-6" /></>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  paste: <><path d="M9 5h6" /><path d="M8 3h8v4H8z" /><rect x="5" y="7" width="14" height="14" rx="2" /></>,
  clear: <><circle cx="12" cy="12" r="8" /><path d="M9 9l6 6" /><path d="M15 9l-6 6" /></>,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M5 12H3M21 12h-2M6.2 6.2l1.4 1.4M16.4 16.4l1.4 1.4M6.2 17.8l1.4-1.4M16.4 7.6l1.4-1.4" />
    </>
  ),
  moon: <path d="M15 4.5A8.5 8.5 0 1 0 19.5 15 7 7 0 0 1 15 4.5z" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-4.4" />
      <path d="M9.9 5.1A11 11 0 0 1 12 5c6 0 10 7 10 7a18 18 0 0 1-4.2 4.8" />
      <path d="M6.1 6.1A18 18 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.1-.8" />
    </>
  ),
  calculator: (
    <>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8" />
      <path d="M8 11h1M12 11h1M16 11h1M8 15h1M12 15h1M16 15h1M8 19h1M12 19h1M16 19h1" />
    </>
  ),
  reagents: (
    <>
      <path d="M9 2h6" />
      <path d="M10 2v6.5L5.5 17A2.5 2.5 0 0 0 7.7 21h8.6a2.5 2.5 0 0 0 2.2-3.9L14 8.5V2" />
      <path d="M8 15h8" />
    </>
  ),
  beaker: (
    <>
      <path d="M9 2h6" />
      <path d="M10 2v7L4.5 18A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.8-3L14 9V2" />
      <path d="M6.5 15h11" />
    </>
  ),
  edit: (
    <>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
      <path d="M14.5 5.5l3 3" />
    </>
  ),
};

export function Icon({
  name,
  className = "h-4 w-4",
  ...rest
}: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
