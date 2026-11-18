// City edits made by this player, with undo (Ctrl/Cmd+Z or the Undo button). Every add, change and delete goes
// through here so the inverse can be recorded: undoing an add deletes it, undoing a change restores the previous
// transform and properties, undoing a delete puts the object back (with a new id).
import { OBJECT_INFO, type CityObject, type ObjectSpec } from '@civitas/shared';
import { useWorld } from '../stores/world';
import { realtime } from './realtime';

type Patch = Partial<Omit<ObjectSpec, 'type'>>;
type Entry = { kind: 'add'; id: string } | { kind: 'update'; id: string; before: Patch } | { kind: 'delete'; spec: ObjectSpec };

const MAX = 50;
const stack: Entry[] = [];
let pendingAdds = 0; // our obj_add messages whose server echo (with the new id) has not arrived yet
let replaying = false;

const push = (e: Entry) => {
  if (replaying) return;
  stack.push(e);
  if (stack.length > MAX) stack.shift();
  useWorld.getState().set({ undoCount: stack.length });
};

/** Everything needed to put an object back exactly (props missing before get their type defaults where known). */
function snapshot(o: CityObject): Patch {
  const info = OBJECT_INFO[o.type];
  return {
    position: { ...o.position },
    rotationX: o.rotationX ?? 0,
    rotationY: o.rotationY,
    rotationZ: o.rotationZ ?? 0,
    scale: { ...o.scale },
    props: { color: info.color, ...(info.floors ? { floors: info.floors } : {}), ...o.props },
  };
}
const specOf = (o: CityObject): ObjectSpec => ({ type: o.type, ...(snapshot(o) as Omit<ObjectSpec, 'type'>), props: { ...o.props } });

export function addObject(spec: ObjectSpec) {
  if (!replaying) pendingAdds++;
  realtime.send({ t: 'obj_add', spec });
}

/** Called for every obj_added: the first ones created by us after an addObject become undoable adds. */
export function onObjectAdded(o: CityObject) {
  const me = useWorld.getState().self?.userId;
  if (pendingAdds > 0 && o.createdBy === me) {
    pendingAdds--;
    push({ kind: 'add', id: o.id });
  }
}

export function updateObject(o: CityObject, patch: Patch) {
  push({ kind: 'update', id: o.id, before: snapshot(o) });
  realtime.send({ t: 'obj_update', id: o.id, patch });
}

export function deleteObject(o: CityObject) {
  push({ kind: 'delete', spec: specOf(o) });
  realtime.send({ t: 'obj_delete', id: o.id });
}

export function undo() {
  const st = useWorld.getState();
  const e = stack.pop();
  st.set({ undoCount: stack.length });
  if (!e) return;
  replaying = true;
  try {
    if (e.kind === 'add') {
      if (st.objects[e.id]) realtime.send({ t: 'obj_delete', id: e.id });
    } else if (e.kind === 'update') {
      if (st.objects[e.id]) realtime.send({ t: 'obj_update', id: e.id, patch: e.before });
      else return st.notify('That object was deleted, nothing to undo', 'error');
    } else {
      addObject(e.spec);
    }
    st.notify(`Undid ${e.kind === 'add' ? 'adding' : e.kind === 'update' ? 'a change to' : 'deleting'} an object`);
  } finally {
    replaying = false;
  }
}

/** For tests and room changes. */
export function resetUndo() {
  stack.length = 0;
  pendingAdds = 0;
  useWorld.getState().set({ undoCount: 0 });
}
