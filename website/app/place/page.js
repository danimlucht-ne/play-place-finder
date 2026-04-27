'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import PlaceDetailClient from '../components/PlaceDetailClient';

export default function PlacePage() {
  return (
    <Suspense fallback={
      <PlaceDetailClient placeId="" />
    }
    >
      <PlacePageInner />
    </Suspense>
  );
}

function PlacePageInner() {
  const searchParams = useSearchParams();
  const placeId = useMemo(() => searchParams.get('id') || '', [searchParams]);
  return <PlaceDetailClient placeId={placeId} />;
}
