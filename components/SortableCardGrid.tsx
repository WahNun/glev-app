"use client";

import {
  CSSProperties,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * One draggable item — caller renders the actual card content as `node` and
 * provides a stable `id`. The `id` is what gets persisted to Supabase, so
 * keep it short and human-readable (e.g. "glucose-trend").
 */
export type SortableItem = {
  id: string;
  node: ReactNode;
};

type Props = {
  /** Stable ID + rendered card content for each draggable cell. */
  items: SortableItem[];
  /** Order of IDs to render. Unknown IDs are dropped; missing IDs are
   * appended in their declared position so newly-added cards still appear. */
  order: string[];
  /** Fired when the user finishes reordering and exits edit mode. */
  onOrderChange: (newOrder: string[]) => void;
  /** Fired when an item's "x" overlay is tapped while in edit mode.
   *  The wrapper does not actually delete anything — it just notifies the
   *  caller. (No-op by default while persistence isn't wired.) */
  onItemDeleted?: (id: string) => void;
  /** className for the wrapping grid div. Use this to apply your own grid
   *  template (number of columns, gap, etc.). */
  gridClassName?: string;
  /** Inline style for the wrapping grid div — handy for one-off styles like
   *  marginBottom that aren't worth a class. */
  gridStyle?: CSSProperties;
  /** Long-press threshold in ms. iOS uses ~500ms. */
  longPressMs?: number;
};

/**
 * iOS-home-screen-style drag-and-drop reordering for a grid of cards.
 *
 * Interaction:
 *   - Tap a card → normal click passes through to the card (it can still
 *     flip, navigate, etc.).
 *   - Hold a card for ~500ms → enters edit mode AND begins a drag in the
 *     same gesture. All cards start the wiggle animation. A small "×"
 *     appears in each card's top-right corner.
 *   - While in edit mode the user can drag any card to a new slot. Holding
 *     for the activation delay is required for each new drag (matches dnd-kit
 *     behaviour and avoids accidental drags from stray taps).
 *   - Tapping anywhere outside a card exits edit mode and persists the new
 *     order via `onOrderChange`.
 *   - Tapping the "×" calls `onItemDeleted` (callers can ignore it for now —
 *     the spec wants the iOS look without real deletion yet).
 */
export default function SortableCardGrid({
  items,
  order,
  onOrderChange,
  onItemDeleted,
  gridClassName,
  gridStyle,
  longPressMs = 500,
}: Props) {
  // Reconcile the provided order with the available items: keep declared
  // order, drop unknowns, append any items the saved order didn't mention
  // (e.g. a brand-new card the user has never reordered).
  const resolvedOrder = useMemo(() => {
    const known = new Set(items.map(i => i.id));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of order) {
      if (known.has(id) && !seen.has(id)) {
        out.push(id);
        seen.add(id);
      }
    }
    for (const it of items) {
      if (!seen.has(it.id)) out.push(it.id);
    }
    return out;
  }, [items, order]);

  // Local working copy so a drag updates the UI immediately. We sync back to
  // the resolved order whenever it changes from outside (e.g. on initial
  // load after the GET /api/preferences response arrives).
  const [working, setWorking] = useState<string[]>(resolvedOrder);
  useEffect(() => {
    setWorking(resolvedOrder);
  }, [resolvedOrder]);

  const [editing, setEditing] = useState(false);
  const editingRef = useRef(editing);
  useEffect(() => { editingRef.current = editing; }, [editing]);

  // Sensors: 500ms hold to start dragging on touch & mouse, plus keyboard
  // accessibility. The hold doubles as the "enter edit mode" gesture — once
  // a drag starts we also flip `editing` to true so all cards wiggle.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: longPressMs, tolerance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: longPressMs, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // Lookup map for rendering by ID.
  const byId = useMemo(() => {
    const m = new Map<string, SortableItem>();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);

  // Latest working order in a ref so the document-level click handler always
  // commits the freshest state without re-attaching itself on every drag.
  const workingRef = useRef(working);
  useEffect(() => { workingRef.current = working; }, [working]);

  const exitEditMode = useCallback(() => {
    if (!editingRef.current) return;
    setEditing(false);
    onOrderChange(workingRef.current);
  }, [onOrderChange]);

  // Document-level "tap blank space to exit" listener. We mark every
  // sortable card and the gear-style controls with data-glev-sortable so
  // we can ignore clicks on them.
  useEffect(() => {
    if (!editing) return;
    function onDocPointerDown(ev: Event) {
      const target = ev.target as HTMLElement | null;
      if (target && target.closest("[data-glev-sortable='1']")) return;
      exitEditMode();
    }
    function onKey(ev: KeyboardEvent) {
      if (ev.key === "Escape") exitEditMode();
    }
    // Use capture so we win against React's synthetic handlers if needed.
    document.addEventListener("pointerdown", onDocPointerDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [editing, exitEditMode]);

  // Set briefly after a drag finishes so the synthetic click that fires on
  // pointerup gets swallowed (without this, releasing a drag on a FlipCard
  // would also flip it). Read by every SortableCell's onClickCapture.
  const justDraggedRef = useRef(false);

  function handleDragStart() {
    // The first long-press transitions us into edit mode and starts the
    // wiggle on all cards. Subsequent drags also call this but the state
    // is already true.
    if (!editingRef.current) setEditing(true);
  }

  function handleDragEnd(ev: DragEndEvent) {
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 350);
    const { active, over } = ev;
    if (!over || active.id === over.id) return;
    setWorking(prev => {
      const oldIndex = prev.indexOf(String(active.id));
      const newIndex = prev.indexOf(String(over.id));
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function handleDragCancel() {
    justDraggedRef.current = true;
    setTimeout(() => { justDraggedRef.current = false; }, 350);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{
        announcements: {
          onDragStart: ({ active }) => `Picked up card ${active.id}.`,
          onDragOver:  ({ active, over }) => over ? `Card ${active.id} is over slot ${over.id}.` : `Card ${active.id} is no longer over a slot.`,
          onDragEnd:   ({ active, over }) => over ? `Dropped card ${active.id} into slot ${over.id}.` : `Drop of card ${active.id} cancelled.`,
          onDragCancel:({ active }) => `Drag of card ${active.id} cancelled.`,
        },
      }}
    >
      <SortableContext items={working} strategy={rectSortingStrategy}>
        <div className={gridClassName} style={gridStyle}>
          {working.map(id => {
            const item = byId.get(id);
            if (!item) return null;
            return (
              <SortableCell
                key={id}
                id={id}
                editing={editing}
                justDraggedRef={justDraggedRef}
                onDelete={onItemDeleted}
              >
                {item.node}
              </SortableCell>
            );
          })}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function SortableCell({
  id,
  children,
  editing,
  justDraggedRef,
  onDelete,
}: {
  id: string;
  children: ReactNode;
  editing: boolean;
  justDraggedRef: { current: boolean };
  onDelete?: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: "relative",
    // Hide the original card while the overlay draws so we don't double up.
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 10 : undefined,
    // Touch on mobile: while in edit mode the user is reordering, so tell
    // the browser not to start a vertical pan when they hold a card. When
    // not editing we leave the default scroll behaviour intact (the 500ms
    // activation delay still lets normal scrolls through).
    touchAction: editing ? "none" : "manipulation",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-glev-sortable="1"
      {...attributes}
      {...listeners}
      // Keyboard a11y: dnd-kit wires Space/Enter to pick up & arrows to move
      // via the spread above. We leave them alone.
    >
      <div
        className={editing ? "glev-wiggle" : undefined}
        // While in edit mode, swallow taps so children (FlipCards, expandable
        // entries) don't activate. Plain tap during edit is reserved for
        // exiting edit mode (handled by the document-level pointerdown
        // listener at the parent). The drag itself uses dnd-kit listeners
        // attached to the outer wrapper above and still fires.
        // Outside edit mode, also block any click that fires immediately
        // after a drag releases on this card (avoids an unintentional flip).
        onClickCapture={(e) => {
          if (editing || justDraggedRef.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        style={editing ? { pointerEvents: "none" } : undefined}
      >
        {children}
      </div>
      {editing && (
        <button
          type="button"
          aria-label={`Remove card ${id}`}
          data-glev-sortable="1"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onDelete?.(id);
          }}
          style={{
            position: "absolute",
            top: -8,
            left: -8,
            width: 24,
            height: 24,
            borderRadius: 999,
            background: "var(--surface-alt)",
            color: "var(--text-strong)",
            border: "1px solid var(--border-strong)",
            boxShadow: "var(--shadow-card)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            padding: 0,
            fontSize: 14,
            lineHeight: 1,
            fontWeight: 600,
            zIndex: 20,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}
