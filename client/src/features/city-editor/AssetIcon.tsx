import type { ObjectType } from '@civitas/shared';

// Drawn for CIVITAS: each glyph is the object it places, so the library reads without labels at a glance.
const PATHS: Record<ObjectType, React.ReactNode> = {
  residential: <><path d="M4 11.5 12 5l8 6.5" /><path d="M6 10v9h12v-9" /><path d="M10.5 19v-4.5h3V19" /></>,
  office: <><rect x="7" y="3" width="10" height="18" rx="0.5" /><path d="M10 7h1M13 7h1M10 10.5h1M13 10.5h1M10 14h1M13 14h1M11 21v-3h2v3" /></>,
  commercial: <><path d="M4 9h16l-1.5-4h-13z" /><path d="M5 9v11h14V9" /><path d="M4 9c0 1.4 1.8 2 2.7 1M12 9c0 1.4-1.8 2-2.7 1M12 9c0 1.4 1.8 2 2.7 1M20 9c0 1.4-1.8 2-2.7 1" /><path d="M9 20v-5h6v5" /></>,
  school: <><path d="M3 20h18M5 20V11l7-4 7 4v9" /><path d="M12 7V3l3 1.2-3 1.2" /><path d="M10 20v-4h4v4M8 13h1M15 13h1" /></>,
  hospital: <><rect x="4" y="5" width="16" height="15" rx="0.5" /><path d="M12 8.5v6M9 11.5h6" /></>,
  park: <><circle cx="9" cy="9" r="4" /><path d="M9 13v6" /><circle cx="16.5" cy="12" r="2.5" /><path d="M16.5 14.5V19M3 19h18" /></>,
  road: <><path d="M8 3 5 21M16 3l3 18" /><path d="M12 4v2.5M12 10v3M12 17v3" /></>,
  tree: <><path d="M12 21c.3-4 .2-8-.6-11" /><path d="M11.4 10C9 7.5 6 7.2 4 8.5M11.4 10c1-3 4-4.5 7-3.6M11.4 10c3 .2 5.2 2 6 4.5M11.4 10c-2.5.6-4.5 2.7-5 5.2" /></>,
  streetlight: <><path d="M8 21V5c0-1 .8-2 2-2h5" /><path d="M13.5 3v2.5h3V3" /><path d="M6 21h4" /></>,
  bench: <><path d="M4 11h16M4 14h16M6 14v5M18 14v5M5 11V8h14v3" /></>,
  bus_stop: <><path d="M6 21V4" /><rect x="3.5" y="4" width="5" height="5" rx="1" /><rect x="11" y="9" width="10" height="9" rx="1.5" /><path d="M11 13h10M13.5 18v2M18.5 18v2" /></>,
};

export function AssetIcon({ type, className = 'h-6 w-6' }: { type: ObjectType; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {PATHS[type]}
    </svg>
  );
}
