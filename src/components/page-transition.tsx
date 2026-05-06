"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const prevPath = useRef(pathname);
  const [phase, setPhase] = useState<"visible" | "fading-out" | "fading-in">("visible");

  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      setPhase("fading-in");
      const id = setTimeout(() => setPhase("visible"), 400);
      return () => clearTimeout(id);
    }
  }, [pathname]);

  return (
    <div
      className={`h-full w-full transition-opacity duration-400 ease-out ${
        phase === "fading-in" ? "animate-[page-in_0.4s_ease-out_forwards]" : ""
      }`}
      style={phase === "fading-in" ? { opacity: 0 } : { opacity: 1 }}
    >
      <style>{`
        @keyframes page-in {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      {children}
    </div>
  );
}
