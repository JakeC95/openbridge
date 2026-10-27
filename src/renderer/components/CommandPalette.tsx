import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../store";
import { CloseIcon } from "../icons";

interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void | Promise<void>;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const setView = useStore(state => state.setView);
  const setQuery = useStore(state => state.setQuery);
  const search = useStore(state => state.search);
  const clearFilters = useStore(state => state.clearFilters);
  const setFreeOnly = useStore(state => state.setFreeOnly);
  const setFavoritesOnly = useStore(state => state.setFavoritesOnly);
  const settings = useStore(state => state.settings);
  const syncNow = useStore(state => state.runSync);
  const updates = useStore(state => state.checkUpdates);
  const importFolder = useStore(state => state.importFolder);
  const importZip = useStore(state => state.importZip);

  const commands = useMemo<Command[]>(() => {
    const customSearch = text.trim();
    const list: Command[] = [
      {
        id: "discover",
        label: "Go to Discover",
        hint: "Catalogue",
        run: () => setView("discover")
      },
      {
        id: "library",
        label: "Go to Library",
        hint: "Local assets",
        run: () => setView("library")
      },
      {
        id: "downloads",
        label: "Go to Downloads",
        hint: "Queue",
        run: () => setView("downloads")
      },
      {
        id: "settings",
        label: "Go to Settings",
        hint: "Configuration",
        run: () => setView("settings")
      },
      {
        id: "free",
        label: "Show free assets",
        run: () => {
          setView("discover");
          setFreeOnly(true);
        }
      },
      {
        id: "favorites",
        label: "Show favorites",
        run: () => {
          setView("discover");
          setFavoritesOnly(true);
        }
      },
      {
        id: "clear-filters",
        label: "Clear catalogue filters",
        run: () => {
          setView("discover");
          clearFilters();
        }
      },
      {
        id: "sync",
        label: "Sync acquired assets",
        run: () => void syncNow()
      },
      {
        id: "pause-all",
        label: "Pause all downloads",
        run: () => void window.openbridge.downloads.pauseAll()
      },
      {
        id: "resume-all",
        label: "Resume all downloads",
        run: () => void window.openbridge.downloads.resumeAll()
      },
      {
        id: "cancel-all",
        label: "Cancel all downloads",
        run: () => void window.openbridge.downloads.cancelAll()
      },
      {
        id: "import-folder",
        label: "Import asset folder",
        run: () => void importFolder()
      },
      {
        id: "import-zip",
        label: "Import asset zip",
        run: () => void importZip()
      },
      {
        id: "check-updates",
        label: "Check for updates",
        run: () => void updates()
      },
      {
        id: "open-library",
        label: "Open library folder",
        run: () => settings && void window.openbridge.openPath(settings.libraryPath)
      },
      {
        id: "open-log",
        label: "Open OpenBridge log",
        run: () => void window.openbridge.openLogs()
      }
    ];

    if (customSearch) {
      list.unshift({
        id: "search",
        label: `Search Megascans for “${customSearch}”`,
        hint: "Enter",
        run: () => {
          setView("discover");
          setQuery(customSearch);
          void search(true);
        }
      });
    }
    return list;
  }, [
    clearFilters,
    importFolder,
    importZip,
    text,
    search,
    setFavoritesOnly,
    setFreeOnly,
    setQuery,
    setView,
    settings,
    syncNow,
    updates
  ]);

  const filtered = commands.filter(command =>
    `${command.label} ${command.hint ?? ""}`.toLowerCase().includes(text.toLowerCase())
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(value => !value);
        setText("");
        setActive(0);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (active >= filtered.length) setActive(Math.max(0, filtered.length - 1));
  }, [active, filtered.length]);

  function execute(command: Command | undefined): void {
    if (!command) return;
    setOpen(false);
    setText("");
    void command.run();
  }

  if (!open) return null;

  return (
    <div className="palette-overlay" onClick={() => setOpen(false)}>
      <div className="palette" onClick={event => event.stopPropagation()}>
        <div className="palette-search">
          <span>⌘</span>
          <input
            ref={inputRef}
            value={text}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive(index => (index + 1) % Math.max(1, filtered.length));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive(index => (index - 1 + filtered.length) % Math.max(1, filtered.length));
              }
              if (event.key === "Enter") {
                event.preventDefault();
                execute(filtered[active]);
              }
            }}
            placeholder="Type a command or search..."
            aria-label="Command palette"
          />
          <button type="button" className="icon-btn" onClick={() => setOpen(false)}>
            <CloseIcon />
          </button>
        </div>
        <div className="palette-list">
          {filtered.map((command, index) => (
            <button
              key={command.id}
              type="button"
              className={index === active ? "palette-command active" : "palette-command"}
              onMouseEnter={() => setActive(index)}
              onClick={() => execute(command)}
            >
              <span>{command.label}</span>
              {command.hint && <em>{command.hint}</em>}
            </button>
          ))}
          {filtered.length === 0 && <span className="palette-empty">No matching commands</span>}
        </div>
        <div className="palette-footer">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
          <span>ctrl k open</span>
        </div>
      </div>
    </div>
  );
}
