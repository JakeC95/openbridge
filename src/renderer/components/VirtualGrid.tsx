import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";

interface Props<T> {
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  minItemWidth?: number;
  gap?: number;
  aspectRatio?: number;
  overscanRows?: number;
  className?: string;
  itemKey?: (item: T) => string;
}

interface Metrics {
  width: number;
  viewportHeight: number;
  offset: number;
}

function findScrollParent(element: HTMLElement): HTMLElement | null {
  let current = element.parentElement;
  while (current) {
    const style = window.getComputedStyle(current);
    if (/(auto|scroll)/.test(`${style.overflowY}${style.overflow}`)) return current;
    current = current.parentElement;
  }
  return null;
}

export function VirtualGrid<T>({
  items,
  renderItem,
  minItemWidth = 220,
  gap = 28,
  aspectRatio = 1,
  overscanRows = 3,
  className = "",
  itemKey
}: Props<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLElement | null>(null);
  const frameRef = useRef<number | null>(null);
  const [metrics, setMetrics] = useState<Metrics>({
    width: 0,
    viewportHeight: 0,
    offset: 0
  });

  const measure = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const scrollParent = scrollRef.current ?? findScrollParent(container);
    scrollRef.current = scrollParent;
    const width = container.clientWidth;
    if (!scrollParent) {
      setMetrics({ width, viewportHeight: window.innerHeight, offset: 0 });
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const parentRect = scrollParent.getBoundingClientRect();
    setMetrics({
      width,
      viewportHeight: parentRect.height,
      offset: Math.max(0, parentRect.top - containerRect.top)
    });
  }, []);

  const scheduleMeasure = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      measure();
    });
  }, [measure]);

  useLayoutEffect(() => {
    measure();
  }, [measure, items.length]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const scrollParent = findScrollParent(container);
    scrollRef.current = scrollParent;
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(container);
    if (scrollParent) observer.observe(scrollParent);
    scrollParent?.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      observer.disconnect();
      scrollParent?.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    };
  }, [scheduleMeasure]);

  const width = metrics.width;
  const columns =
    width > 0
      ? Math.max(1, Math.floor((width + gap) / (minItemWidth + gap)))
      : 1;
  const itemWidth =
    width > 0 ? (width - gap * (columns - 1)) / columns : minItemWidth;
  const itemHeight = itemWidth / aspectRatio;
  const rowStep = itemHeight + gap;
  const rows = Math.ceil(items.length / columns);
  const totalHeight =
    rows > 0 ? rows * itemHeight + Math.max(0, rows - 1) * gap : 0;

  const visibleRows =
    metrics.viewportHeight > 0
      ? Math.ceil(metrics.viewportHeight / rowStep) + overscanRows * 2
      : 8;
  const startRow =
    width > 0
      ? Math.min(
          Math.max(0, rows - visibleRows),
          Math.max(0, Math.floor(metrics.offset / rowStep) - overscanRows)
        )
      : 0;
  const endRow = Math.min(rows, startRow + visibleRows);
  const startIndex = startRow * columns;
  const endIndex = Math.min(items.length, endRow * columns);
  const visible = items.slice(startIndex, endIndex);

  // Loaded catalogue results can be sorted again when a page arrives. Preserve the visible
  // card, not merely scrollTop, when newly inserted items move it to another row.
  const anchorRef = useRef<{ key: string; top: number; count: number } | null>(null);
  useLayoutEffect(() => {
    const container = containerRef.current;
    const parent = scrollRef.current;
    const anchor = anchorRef.current;
    if (container && parent && itemKey && anchor && items.length > anchor.count && width > 0) {
      const index = items.findIndex(item => itemKey(item) === anchor.key);
      if (index >= 0) {
        const newTop = container.getBoundingClientRect().top + Math.floor(index / columns) * rowStep;
        parent.scrollTop += newTop - anchor.top;
        measure();
      }
    }
    if (anchor && items.length > anchor.count) anchorRef.current = null;
    const capture = (event: Event) => {
      if (!container || !parent || !itemKey || !parent.contains((event as CustomEvent<Node>).detail)) return;
      const parentTop = parent.getBoundingClientRect().top;
      const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-grid-key]"));
      const card = cards.find(element => element.getBoundingClientRect().bottom > parentTop);
      if (card?.dataset.gridKey) anchorRef.current = { key: card.dataset.gridKey, top: card.getBoundingClientRect().top, count: items.length };
    };
    window.addEventListener("openbridge:before-page-load", capture);
    return () => window.removeEventListener("openbridge:before-page-load", capture);
  }, [items, itemKey, columns, rowStep, width, measure]);

  return (
    <div
      ref={containerRef}
      className={`virtual-grid ${className}`.trim()}
      style={{ height: totalHeight }}
    >
      <div
        className="asset-grid virtual-grid-window"
        style={{
          top: startRow * rowStep,
          gap,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
        }}
      >
        {visible.map((item, index) => itemKey
          ? <div key={itemKey(item)} data-grid-key={itemKey(item)}>{renderItem(item, startIndex + index)}</div>
          : renderItem(item, startIndex + index))}
      </div>
    </div>
  );
}
