import { useEffect, useState } from "react";

/**
 * Hold a "loading" state for at least `minMs` after mount, even if the data
 * arrives sooner. Prevents the loader from flashing for 50ms and disappearing,
 * which reads as glitchy. Returns `true` while we should still be showing the
 * loader. Combine with the actual data-fetch state via `loading || !data`.
 *
 *   const minLoading = useMinLoader(1000);
 *   if (minLoading || !data) return <BallLoader ... />;
 */
export function useMinLoader(minMs: number = 1000): boolean {
  const [stillLoading, setStillLoading] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setStillLoading(false), minMs);
    return () => clearTimeout(t);
  }, [minMs]);
  return stillLoading;
}
