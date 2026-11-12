import { useEffect, useState } from 'react';
import { availableAction, interact, jump, wave } from '../../engine/core/interactions';
import { BattleToggle, ViewToggle } from '../battle/BattleHud';

/** Label of what the player can do right now, polled (cheap) instead of re-rendering every frame. */
function useAvailableAction() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const t = setInterval(() => setLabel(availableAction()?.label ?? null), 150);
    return () => clearInterval(t);
  }, []);
  return label;
}

/** Desktop: a single prompt above the toolbar ("E  Sit on bench"). Click works too. */
export function InteractionPrompt() {
  const label = useAvailableAction();
  if (!label) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-24 z-10 flex justify-center">
      <button onClick={interact} className="pointer-events-auto flex items-center gap-2 rounded-md bg-stone-900/85 py-1.5 pl-1.5 pr-3 text-sm text-white shadow-lg">
        <kbd className="grid h-6 min-w-6 place-items-center rounded bg-white px-1.5 font-sans text-xs font-semibold text-stone-900">E</kbd>
        {label}
      </button>
    </div>
  );
}

/** Phone: thumb-sized buttons on the right; the action button only appears when something is in reach. */
export function TouchActions() {
  const label = useAvailableAction();
  const btn = 'pointer-events-auto grid h-14 w-14 place-items-center rounded-full bg-stone-900/70 text-xs font-medium text-white active:bg-stone-900';
  return (
    <div className="pointer-events-none absolute bottom-[calc(80px+env(safe-area-inset-bottom))] right-4 z-10 flex flex-col items-end gap-3">
      {label && (
        <button onClick={interact} className="pointer-events-auto rounded-full bg-white px-4 py-3 text-sm font-medium text-stone-900 shadow-lg">{label}</button>
      )}
      <div className="flex gap-2">
        <ViewToggle className="pointer-events-auto bg-stone-900/70" />
        <BattleToggle className="pointer-events-auto bg-stone-900/70" />
      </div>
      <div className="flex gap-3">
        <button onClick={wave} className={btn} aria-label="Wave">Wave</button>
        <button onClick={jump} className={btn} aria-label="Jump">Jump</button>
      </div>
    </div>
  );
}
