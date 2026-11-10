// Ground-floor interiors, generated from the building type and footprint. Pure data: used for rendering
// (Interior.tsx) and for gameplay (seats you can sit on, the exit door).
// Local frame: origin at building centre on the floor, +z = front (door side).
import { OBJECT_INFO, type CityObject, type ObjectType } from '@civitas/shared';
import type { Part } from './parts';

export interface LocalSeat { x: number; z: number; r: number } // r = facing (0 = +z)
export interface InteriorLayout { hw: number; hd: number; height: number; floor: string; wall: string; parts: Part[]; seats: LocalSeat[] }

const WOOD = '#8a6446', DARK = '#3b3a38', FABRIC = '#5f6f7a', WHITE = '#efece6', PLANT = '#4d7a34';

const chair = (x: number, z: number, r: number, color = WOOD): Part[] => {
  // seat + backrest; backrest sits behind the person (opposite of facing)
  const bx = -Math.sin(r) * 0.22, bz = -Math.cos(r) * 0.22;
  return [
    { geo: 'box', pos: [x, 0.45, z], size: [0.48, 0.08, 0.48], color },
    { geo: 'box', pos: [x, 0.22, z], size: [0.4, 0.44, 0.4], color: DARK },
    { geo: 'box', pos: [x + bx, 0.78, z + bz], size: [Math.abs(Math.cos(r)) * 0.42 + 0.06, 0.6, Math.abs(Math.sin(r)) * 0.42 + 0.06], color },
  ];
};
const plant = (x: number, z: number): Part[] => [
  { geo: 'cyl', pos: [x, 0.25, z], size: [0.45, 0.5, 0.45], color: '#b8532e' },
  { geo: 'sphere', pos: [x, 0.95, z], size: [0.9, 1, 0.9], color: PLANT },
];

/** Half extents of the room for an object (footprint x object scale, minus wall thickness). */
export function roomSize(o: Pick<CityObject, 'type' | 'scale'>) {
  const [w, d] = OBJECT_INFO[o.type].footprint;
  return { hw: (w * o.scale.x) / 2 - 0.15, hd: (d * o.scale.z) / 2 - 0.15 };
}

export function interiorFor(o: Pick<CityObject, 'type' | 'scale'>): InteriorLayout {
  const { hw, hd } = roomSize(o);
  const parts: Part[] = [];
  const seats: LocalSeat[] = [];
  const seat = (x: number, z: number, r: number, color?: string) => { parts.push(...chair(x, z, r, color)); seats.push({ x, z, r }); };
  let floor = '#b89b78', wall = '#ece4d6';
  const type: ObjectType = o.type;

  switch (type) {
    case 'residential': {
      parts.push({ geo: 'box', pos: [0, 0.01, -0.3], size: [Math.min(2.6, hw), 0.02, 1.8], color: '#c9b28f' }); // rug
      // sofa against the back wall, two seats
      parts.push({ geo: 'box', pos: [0, 0.22, -hd + 0.5], size: [2.2, 0.44, 0.8], color: FABRIC });
      parts.push({ geo: 'box', pos: [0, 0.65, -hd + 0.18], size: [2.2, 0.6, 0.2], color: FABRIC });
      seats.push({ x: -0.55, z: -hd + 0.55, r: 0 }, { x: 0.55, z: -hd + 0.55, r: 0 });
      parts.push({ geo: 'box', pos: [0, 0.2, -hd + 1.6], size: [1, 0.4, 0.55], color: WOOD }); // coffee table
      parts.push({ geo: 'box', pos: [-hw + 0.25, 0.9, 0.2], size: [0.4, 1.8, 1.4], color: WOOD }); // bookshelf
      seat(hw - 0.7, -0.2, -Math.PI / 2, FABRIC); // armchair facing the room
      parts.push(...plant(hw - 0.5, -hd + 0.5));
      break;
    }
    case 'office': {
      floor = '#9a9a96'; wall = '#e9e8e4';
      for (const x of [-1.6, 1.6]) {
        parts.push({ geo: 'box', pos: [x, 0.74, -1.3], size: [1.6, 0.06, 0.8], color: WHITE }); // desk top
        parts.push({ geo: 'box', pos: [x, 0.36, -1.3], size: [1.5, 0.72, 0.7], color: DARK });
        parts.push({ geo: 'box', pos: [x, 1.0, -1.55], size: [0.7, 0.42, 0.05], color: '#1f2933' }); // monitor
        seat(x, -0.55, Math.PI, DARK);
      }
      parts.push({ geo: 'box', pos: [0, 1.6, -hd + 0.03], size: [2.4, 1.1, 0.04], color: '#fbfbf8' }); // whiteboard
      parts.push(...plant(-hw + 0.5, hd - 1.2), ...plant(hw - 0.5, hd - 1.2));
      break;
    }
    case 'commercial': {
      floor = '#c8b79c';
      parts.push({ geo: 'box', pos: [0, 0.5, -hd + 1], size: [3.2, 1, 0.7], color: WOOD }); // counter
      parts.push({ geo: 'box', pos: [0, 1.1, -hd + 0.25], size: [4, 2.2, 0.4], color: '#6f5440' }); // shelves
      for (const x of [-2.6, 2.6]) {
        parts.push({ geo: 'cyl', pos: [x, 0.74, 0.6], size: [0.9, 0.05, 0.9], color: WHITE });
        parts.push({ geo: 'cyl', pos: [x, 0.37, 0.6], size: [0.12, 0.74, 0.12], color: DARK });
        seat(x - 0.75, 0.6, Math.PI / 2);
        seat(x + 0.75, 0.6, -Math.PI / 2);
      }
      break;
    }
    case 'school': {
      floor = '#b9a27f'; wall = '#efe7d3';
      parts.push({ geo: 'box', pos: [0, 1.5, -hd + 0.03], size: [5, 1.4, 0.04], color: '#2f4a3a' }); // blackboard
      parts.push({ geo: 'box', pos: [0, 0.4, -hd + 1.2], size: [1.6, 0.8, 0.7], color: WOOD }); // teacher desk
      for (const x of [-3.2, 0, 3.2]) for (const z of [-0.6, 1.6]) {
        if (Math.abs(x) + 0.6 > hw) continue;
        parts.push({ geo: 'box', pos: [x, 0.7, z], size: [1.2, 0.05, 0.6], color: '#d8c39e' });
        parts.push({ geo: 'box', pos: [x, 0.34, z], size: [1.1, 0.68, 0.5], color: DARK });
        seat(x, z + 0.6, Math.PI, WOOD);
      }
      break;
    }
    case 'hospital': {
      floor = '#cfd3d2'; wall = '#f3f3f0';
      parts.push({ geo: 'box', pos: [0, 0.55, -1], size: [3, 1.1, 0.8], color: WHITE }); // reception
      for (const x of [-hw + 1.1, hw - 1.1]) {
        parts.push({ geo: 'box', pos: [x, 0.3, -hd + 1.4], size: [1.1, 0.6, 2.1], color: '#e9eef0' }); // bed
        parts.push({ geo: 'box', pos: [x, 0.65, -hd + 0.55], size: [0.8, 0.15, 0.4], color: '#ffffff' }); // pillow
      }
      for (const x of [-2.4, -1.6, 1.6, 2.4]) if (Math.abs(x) + 0.4 < hw) seat(x, hd - 2, Math.PI, '#5b8fa8');
      parts.push(...plant(-hw + 0.5, hd - 0.8));
      break;
    }
    default:
      break;
  }
  return { hw, hd, height: 3.2, floor, wall, parts, seats };
}
