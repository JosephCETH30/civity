import { useMemo, useState, type ReactNode } from 'react';
import { BUILDING_TYPES, OBJECT_INFO, OBJECT_TYPES, PLACEABLE_TYPES, STYLES, type CityObject, type ObjectSpec, type ObjectType } from '@civitas/shared';
import { useWorld } from '../../stores/world';
import { realtime } from '../../services/realtime';
import { Button, Input, Select } from '../../components/ui';
import { cn } from '@/lib/utils';
import { AssetIcon } from './AssetIcon';

export function useCanEdit() {
  return useWorld((s) => s.self?.role === 'owner' || s.self?.role === 'editor');
}

/** Asset library: pick a type, then click/tap the ground to place it. */
export function AssetLibrary({ compact = false }: { compact?: boolean }) {
  const tool = useWorld((s) => s.tool);
  const set = useWorld((s) => s.set);
  const canEdit = useCanEdit();
  if (!canEdit) return <p className="text-sm text-muted-foreground">You can walk around and inspect. Ask the owner for edit access to build.</p>;
  return (
    <div>
      <div className={cn('grid gap-1.5', compact ? 'grid-cols-4' : 'grid-cols-3')}>
        {PLACEABLE_TYPES.map((t) => {
          const active = tool.kind === 'place' && tool.type === t;
          return (
            <button
              key={t}
              onClick={() => set({ tool: active ? { kind: 'select' } : { kind: 'place', type: t }, selectedId: null })}
              aria-pressed={active}
              className={cn(
                'flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-md border text-[11px] font-medium transition-colors',
                active ? 'border-primary bg-primary/8 text-primary' : 'border-transparent bg-muted/70 text-foreground hover:bg-muted',
              )}
            >
              <AssetIcon type={t} />
              {OBJECT_INFO[t].label}
            </button>
          );
        })}
      </div>
      <p className="mt-2.5 text-xs text-muted-foreground">Photo sculptures: walk into a park and press E to turn a photo into 3D.</p>
      {tool.kind === 'place' && (
        <p className="mt-2.5 text-xs text-muted-foreground">Click the ground to place a {OBJECT_INFO[tool.type].label.toLowerCase()}. Pick it again to stop.</p>
      )}
    </div>
  );
}

/** City objects grouped by type. Selecting an item selects it in the scene. */
export function Hierarchy() {
  const objects = useWorld((s) => s.objects);
  const selectedId = useWorld((s) => s.selectedId);
  const set = useWorld((s) => s.set);
  const [open, setOpen] = useState<ObjectType | null>(null);
  const groups = useMemo(() => {
    const g = new Map<ObjectType, CityObject[]>();
    for (const o of Object.values(objects)) g.set(o.type, [...(g.get(o.type) ?? []), o]);
    return OBJECT_TYPES.filter((t) => g.has(t)).map((t) => [t, g.get(t)!] as const);
  }, [objects]);
  if (!groups.length) return <p className="text-sm text-muted-foreground">The city is empty. Place something from the library.</p>;
  return (
    <ul className="text-sm">
      {groups.map(([t, list]) => (
        <li key={t}>
          <button className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted" onClick={() => setOpen(open === t ? null : t)} aria-expanded={open === t}>
            <AssetIcon type={t} className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="flex-1">{OBJECT_INFO[t].label}</span>
            <span className="tabular-nums text-muted-foreground">{list.length}</span>
          </button>
          {open === t && (
            <ul className="mb-1 ml-[17px] max-h-48 overflow-y-auto border-l pl-2">
              {list.slice(0, 100).map((o) => (
                <li key={o.id}>
                  <button
                    onClick={() => set({ selectedId: o.id, tool: { kind: 'select' } })}
                    className={cn('w-full truncate rounded px-2 py-1 text-left text-xs', selectedId === o.id ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}
                  >
                    {o.props.name || `${OBJECT_INFO[t].label} at ${o.position.x}, ${o.position.z}`}
                  </button>
                </li>
              ))}
              {list.length > 100 && <li className="px-2 py-1 text-xs text-muted-foreground">{list.length - 100} more not shown</li>}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[72px_1fr] items-center gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

/** Inspector for the selected object. Editors can change it; everyone else gets a read-only view. */
export function PropertiesPanel() {
  const obj = useWorld((s) => (s.selectedId ? s.objects[s.selectedId] : undefined));
  const mode = useWorld((s) => s.transformMode);
  const set = useWorld((s) => s.set);
  const canEdit = useCanEdit();
  if (!obj) {
    return (
      <div className="px-1 py-6 text-center text-sm text-muted-foreground">
        Select a building, road or tree in the city to see and change it here.
      </div>
    );
  }
  const info = OBJECT_INFO[obj.type];
  const isBuilding = BUILDING_TYPES.includes(obj.type);
  const update = (patch: Partial<Omit<ObjectSpec, 'type'>>) => realtime.send({ t: 'obj_update', id: obj.id, patch });
  const nudge = (dx: number, dz: number) => update({ position: { x: obj.position.x + dx, y: 0, z: obj.position.z + dz } });

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-md bg-muted"><AssetIcon type={obj.type} className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h3 className="truncate font-medium">{obj.props.name || info.label}</h3>
          <p className="text-xs text-muted-foreground">
            {info.label} · {obj.position.x}, {obj.position.z} · {Math.round((obj.rotationY * 180) / Math.PI)}°{isBuilding ? ` · ${obj.props.floors ?? info.floors} floors` : ''}
          </p>
        </div>
      </div>
      {canEdit && (
        <>
          <div className="space-y-2.5">
            <Row label="Name">
              <Input key={obj.id + (obj.props.name ?? '')} defaultValue={obj.props.name ?? ''} maxLength={60} placeholder={info.label} className="h-9"
                onBlur={(e) => e.target.value !== (obj.props.name ?? '') && update({ props: { name: e.target.value } })} />
            </Row>
            {isBuilding && (
              <>
                <Row label="Floors">
                  <Input type="number" min={1} max={40} key={obj.id + 'f' + obj.props.floors} defaultValue={obj.props.floors ?? info.floors} className="h-9"
                    onBlur={(e) => { const v = Math.max(1, Math.min(40, Math.round(+e.target.value || 1))); if (v !== obj.props.floors) update({ props: { floors: v } }); }} />
                </Row>
                <Row label="Style">
                  <Select value={obj.props.style ?? ''} className="h-9" onChange={(e) => e.target.value && update({ props: { style: e.target.value as (typeof STYLES)[number] } })}>
                    <option value="">Default</option>
                    {STYLES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                  </Select>
                </Row>
              </>
            )}
            {obj.type === 'artwork' && (
              <>
                <Row label={`Depth ${(obj.props.depthScale ?? 0.8).toFixed(1)} m`}>
                  <input type="range" min={0.2} max={2} step={0.1} value={obj.props.depthScale ?? 0.8} className="w-full accent-[var(--primary)]"
                    onChange={(e) => update({ props: { depthScale: +e.target.value } })} aria-label="Sculpture depth" />
                </Row>
                <Row label={`Background ${Math.round((obj.props.cutout ?? 0) * 100)}%`}>
                  <input type="range" min={0} max={0.6} step={0.05} value={obj.props.cutout ?? 0} className="w-full accent-[var(--primary)]"
                    onChange={(e) => update({ props: { cutout: +e.target.value } })} aria-label="Remove background" />
                </Row>
              </>
            )}
            <Row label="Color">
              <input type="color" value={obj.props.color ?? info.color} onChange={(e) => update({ props: { color: e.target.value } })} className="h-9 w-full cursor-pointer rounded-md border bg-card p-1" />
            </Row>
            <Row label={`Scale ${obj.scale.x}×`}>
              <input type="range" min={0.25} max={4} step={0.25} value={obj.scale.x} className="w-full accent-[var(--primary)]"
                onChange={(e) => { const v = +e.target.value; update({ scale: { x: v, y: v, z: v } }); }} />
            </Row>
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="hidden rounded-md bg-muted p-0.5 md:flex" role="group" aria-label="Gizmo mode">
              {(['translate', 'rotate', 'scale'] as const).map((m) => (
                <button key={m} onClick={() => set({ transformMode: m })} aria-pressed={mode === m}
                  className={cn('flex-1 rounded-[5px] px-2 py-1.5 text-xs font-medium capitalize', mode === m ? 'bg-card shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{m === 'translate' ? 'Move' : m}</button>
              ))}
            </div>
            {/* Touch-friendly controls: no gizmo dragging needed. */}
            <div className="grid grid-cols-3 gap-1.5">
              <Button variant="secondary" size="sm" onClick={() => update({ rotationY: obj.rotationY - Math.PI / 12 })} aria-label="Rotate left">⟲ 15°</Button>
              <Button variant="secondary" size="sm" onClick={() => nudge(0, -1)} aria-label="Move north">↑</Button>
              <Button variant="secondary" size="sm" onClick={() => update({ rotationY: obj.rotationY + Math.PI / 12 })} aria-label="Rotate right">⟳ 15°</Button>
              <Button variant="secondary" size="sm" onClick={() => nudge(-1, 0)} aria-label="Move west">←</Button>
              <Button variant="secondary" size="sm" onClick={() => nudge(0, 1)} aria-label="Move south">↓</Button>
              <Button variant="secondary" size="sm" onClick={() => nudge(1, 0)} aria-label="Move east">→</Button>
            </div>
          </div>
          <button className="w-full rounded-md py-2 text-sm font-medium text-destructive hover:bg-destructive/8" onClick={() => realtime.send({ t: 'obj_delete', id: obj.id })}>
            Delete object
          </button>
        </>
      )}
    </div>
  );
}

const ROUTE_COLORS = ['#2f7de1', '#e0663a', '#3aa76d', '#9b6fd0'];

/** Transport routes: build by picking stops in order, list and delete routes. */
export function RoutesPanel() {
  const routes = useWorld((s) => s.routes);
  const objects = useWorld((s) => s.objects);
  const tool = useWorld((s) => s.tool);
  const set = useWorld((s) => s.set);
  const canEdit = useCanEdit();
  const [name, setName] = useState('');
  const stopCount = useMemo(() => Object.values(objects).filter((o) => o.type === 'bus_stop').length, [objects]);
  const stopName = (id: string) => objects[id]?.props.name || 'Stop';
  const list = Object.values(routes);

  return (
    <div className="space-y-3 text-sm">
      {canEdit && (tool.kind === 'route' ? (
        <div className="space-y-2.5 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-amber-900">Click bus stops in the order the bus visits them.</p>
          <p className="text-xs font-medium">{tool.stops.length ? tool.stops.map(stopName).join(' → ') : 'No stops picked yet'}</p>
          <Input placeholder="Route name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="h-9" />
          <div className="flex gap-2">
            <Button size="sm" disabled={tool.stops.length < 2} onClick={() => {
              realtime.send({ t: 'route_add', route: { name: name.trim() || `Line ${list.length + 1}`, stopIds: tool.stops, color: ROUTE_COLORS[list.length % 4] } });
              set({ tool: { kind: 'select' } }); setName('');
            }}>Create route</Button>
            <Button size="sm" variant="ghost" onClick={() => set({ tool: { kind: 'select' } })}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="secondary" className="w-full" disabled={stopCount < 2} onClick={() => set({ tool: { kind: 'route', stops: [] }, selectedId: null })}>
          {stopCount < 2 ? 'Place at least 2 bus stops first' : 'New bus route'}
        </Button>
      ))}
      {list.length ? (
        <ul className="divide-y rounded-md border">
          {list.map((r) => (
            <li key={r.id} className="flex items-center gap-2.5 px-3 py-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="text-xs text-muted-foreground">{r.stopIds.length} stops</span>
              {canEdit && <button className="rounded px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground" aria-label={`Delete ${r.name}`} onClick={() => realtime.send({ t: 'route_delete', id: r.id })}>✕</button>}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-muted-foreground">No routes yet. Place bus stops, then connect them here.</p>}
    </div>
  );
}
