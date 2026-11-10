// Photo sculptures in the city: each `artwork` object shows its photo as a 3D relief standing on its plinth.
import { Suspense, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useLoader } from '@react-three/fiber';
import type { CityObject } from '@civitas/shared';
import { depthGrid, reliefGeometry } from './relief';
import { ErrorBoundary } from '../../components/ErrorBoundary';

const PLINTH_TOP = 0.6;

export function ReliefMesh({ image, depth, aspect, depthScale, cutout, segments, castShadow = true }: {
  image: THREE.Texture; depth: THREE.Texture; aspect: number; depthScale: number; cutout: number; segments: number; castShadow?: boolean;
}) {
  const grid = useMemo(() => depthGrid(depth.image as HTMLImageElement), [depth]);
  const geo = useMemo(() => reliefGeometry(grid, aspect, depthScale, segments), [grid, aspect, depthScale, segments]);
  useEffect(() => () => geo.dispose(), [geo]);
  const mat = useMemo(() => {
    image.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map: image,
      roughness: 0.75,
      side: THREE.DoubleSide,
      // Background removal: far pixels (dark in the depth map) are cut away.
      alphaMap: cutout > 0 ? depth : null,
      alphaTest: cutout,
    });
  }, [image, depth, cutout]);
  useEffect(() => () => mat.dispose(), [mat]);
  return <mesh geometry={geo} material={mat} castShadow={castShadow} />;
}

function Sculpture({ object, segments }: { object: CityObject; segments: number }) {
  const id = object.props.assetId!;
  const [image, depth] = useLoader(THREE.TextureLoader, [`/api/artworks/${id}/image`, `/api/artworks/${id}/depth`]);
  return (
    <group position={[object.position.x, PLINTH_TOP * object.scale.y, object.position.z]} rotation-y={object.rotationY} scale={[object.scale.x, object.scale.y, object.scale.z]}>
      <ReliefMesh image={image} depth={depth} aspect={object.props.aspect ?? 1} depthScale={object.props.depthScale ?? 0.8} cutout={object.props.cutout ?? 0} segments={segments} />
    </group>
  );
}

/** One Suspense per sculpture so a slow image never blocks the rest of the city. */
export function ArtworkReliefs({ objects, lowDetail }: { objects: CityObject[]; lowDetail: boolean }) {
  return (
    <>
      {objects.filter((o) => o.type === 'artwork' && o.props.assetId).map((o) => (
        // A missing image (e.g. sculpture just deleted) must not take the whole 3D view down.
        <ErrorBoundary key={o.id} fallback={() => null}>
          <Suspense fallback={null}>
            <Sculpture object={o} segments={lowDetail ? 64 : 160} />
          </Suspense>
        </ErrorBoundary>
      ))}
    </>
  );
}
