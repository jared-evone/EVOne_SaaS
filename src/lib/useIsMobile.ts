import { useEffect, useState } from 'react';

function useMedia(query: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setOn(e.matches);
    setOn(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return on;
}

// Shared viewport check for the responsive inline-style layouts.
export const useIsMobile = () => useMedia('(max-width: 768px)');

// Tablet portrait and below (a 12.9" iPad upright is 1024 wide): the sidebar
// becomes a slide-over drawer so screens keep the full width.
export const useIsCompact = () => useMedia('(max-width: 1100px)');
