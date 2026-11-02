import { useEffect, useRef, useState } from "react";

export function LoadMore({ loading, remaining, onLoad }: { loading: boolean; remaining: number; onLoad(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [automatic, setAutomatic] = useState(() => localStorage.getItem("openbridge.autoLoad") === "true");
  const load = () => {
    window.dispatchEvent(new CustomEvent("openbridge:before-page-load", { detail: ref.current }));
    onLoad();
  };
  useEffect(() => {
    const node = ref.current;
    if (!node || !automatic || loading) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) load();
    }, { rootMargin: "160px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [automatic, loading, onLoad]);
  return <div className="load-more" ref={ref}>
    <button type="button" className="btn btn-ghost" disabled={loading} onClick={load}>
      {loading ? "Loading..." : `Load more (${remaining.toLocaleString()} left)`}
    </button>
    <label className="auto-load-toggle"><input type="checkbox" checked={automatic} onChange={event => {
      setAutomatic(event.target.checked); localStorage.setItem("openbridge.autoLoad", String(event.target.checked));
    }} /> Automatically load more</label>
  </div>;
}
