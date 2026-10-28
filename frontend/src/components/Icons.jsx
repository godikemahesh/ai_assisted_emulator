// Small inline stroke icons (no icon library needed, works offline).
const Svg = ({ children, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {children}
  </svg>
);

export const IconChip = (p) => (
  <Svg {...p}><rect x="6" y="6" width="12" height="12" rx="2" /><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" /></Svg>
);
export const IconMemory = (p) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M3 15h18M9 4v16M15 4v16" /></Svg>
);
export const IconTrace = (p) => (
  <Svg {...p}><path d="M4 6h16M4 12h10M4 18h13" /><circle cx="19" cy="12" r="1.5" /></Svg>
);
export const IconCode = (p) => (
  <Svg {...p}><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" /></Svg>
);
export const IconSpark = (p) => (
  <Svg {...p}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></Svg>
);
export const IconBook = (p) => (
  <Svg {...p}><path d="M4 5a2 2 0 012-2h13v16H6a2 2 0 00-2 2z" /><path d="M4 19V5M8 7h7" /></Svg>
);
export const IconPlay = (p) => <Svg {...p}><path d="M7 5l12 7-12 7z" /></Svg>;
export const IconStep = (p) => <Svg {...p}><path d="M5 5l9 7-9 7z" /><path d="M18 5v14" /></Svg>;
export const IconPause = (p) => <Svg {...p}><path d="M8 5v14M16 5v14" /></Svg>;
export const IconReset = (p) => <Svg {...p}><path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7" /><path d="M4 3v5h5" /></Svg>;
export const IconBuild = (p) => <Svg {...p}><path d="M5 12l4 4L19 6" /></Svg>;
