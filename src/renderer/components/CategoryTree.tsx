import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { CategoryNode } from "../../shared/types";
import { ChevronDownIcon } from "../icons";

interface Props {
  nodes: CategoryNode[];
  selectedPath: string[];
  onSelect: (path: string[]) => void;
}

function pathKey(path: string[]): string {
  return path.join("\u0001");
}

export function CategoryTree({ nodes, selectedPath, onSelect }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setExpanded(current => {
      const next = new Set(current);
      for (let index = 1; index < selectedPath.length; index += 1) {
        next.add(pathKey(selectedPath.slice(0, index)));
      }
      if (selectedPath.length > 0) next.add(pathKey(selectedPath));
      return next;
    });
  }, [selectedPath]);

  const selectedKey = useMemo(() => pathKey(selectedPath), [selectedPath]);

  function toggle(path: string[]): void {
    const key = pathKey(path);
    setExpanded(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function renderNodes(list: CategoryNode[], parentPath: string[]): ReactNode {
    return list.map(node => {
      const path = [...parentPath, node.key];
      const key = pathKey(path);
      const isExpanded = expanded.has(key);
      const isSelected = key === selectedKey;
      const hasChildren = node.children.length > 0;
      return (
        <div key={key} className="category-branch">
          <div
            className={isSelected ? "category-row selected" : "category-row"}
            style={{ paddingLeft: 16 + parentPath.length * 14 }}
          >
            {hasChildren ? (
              <button
                type="button"
                className="category-chevron"
                onClick={() => toggle(path)}
                aria-label={isExpanded ? "Collapse" : "Expand"}
              >
                <ChevronDownIcon
                  width={12}
                  height={12}
                  style={{ transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)" }}
                />
              </button>
            ) : (
              <span className="category-chevron-spacer" />
            )}
            <button
              type="button"
              className="category-label"
              onClick={() => onSelect(path)}
              title={path.join(" / ")}
            >
              {node.label}
            </button>
            {node.count > 0 && <span className="category-count">{node.count.toLocaleString()}</span>}
          </div>
          {hasChildren && isExpanded && renderNodes(node.children, path)}
        </div>
      );
    });
  }

  return (
    <div className="category-tree">
      <button
        type="button"
        className={selectedPath.length === 0 ? "category-row all selected" : "category-row all"}
        onClick={() => onSelect([])}
      >
        <span className="category-chevron-spacer" />
        <span className="category-label">All categories</span>
      </button>
      {renderNodes(nodes, [])}
    </div>
  );
}

