import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDownIcon } from "../icons";

interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

interface Props {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
}

interface MenuPosition {
  top: number;
  left: number;
  width: number;
}

export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
  className = "",
  disabled = false
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const selected = options.find(option => option.value === value) ?? options[0];

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = Math.min(300, options.length * 36 + 8);
    const top =
      rect.bottom + 4 + menuHeight > window.innerHeight
        ? Math.max(8, rect.top - menuHeight - 4)
        : rect.bottom + 4;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));
    setPosition({ top, left, width: rect.width });
    requestAnimationFrame(() => menuRef.current?.focus());
  }, [open, options.length]);

  useEffect(() => {
    if (!open) return;
    const close = (): void => setOpen(false);
    const closeOnOutside = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", closeOnOutside);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", closeOnOutside);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function choose(next: string): void {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  }

  function moveActive(direction: number): void {
    setActiveIndex(index => {
      const start = index < 0 ? 0 : index;
      return (start + direction + options.length) % options.length;
    });
  }

  function chooseActive(): void {
    const index = activeIndex < 0
      ? Math.max(0, options.findIndex(option => option.value === value))
      : activeIndex;
    const option = options[index];
    if (option && !option.disabled) choose(option.value);
  }

  return (
    <div className={`dropdown-control ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="dropdown-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setOpen(current => {
            const next = !current;
            if (next) {
              setActiveIndex(
                Math.max(0, options.findIndex(option => option.value === value))
              );
            }
            return next;
          });
        }}
        onKeyDown={event => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            else moveActive(event.key === "ArrowDown" ? 1 : -1);
            return;
          }
          if (open && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            chooseActive();
          }
        }}
      >
        <span>{selected?.label ?? ""}</span>
        <ChevronDownIcon width={16} height={16} />
      </button>

      {open &&
        position &&
        createPortal(
          <div
            ref={menuRef}
            className="dropdown-menu"
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            style={{
              top: position.top,
              left: position.left,
              width: position.width
            }}
            onKeyDown={event => {
              if (event.key === "Escape") {
                setOpen(false);
                triggerRef.current?.focus();
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                moveActive(event.key === "ArrowDown" ? 1 : -1);
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                chooseActive();
              }
            }}
          >
            {options.map((option, index) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                disabled={option.disabled}
                className={
                  option.value === value
                    ? index === activeIndex
                      ? "dropdown-option selected active"
                      : "dropdown-option selected"
                    : index === activeIndex
                      ? "dropdown-option active"
                      : "dropdown-option"
                }
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}
