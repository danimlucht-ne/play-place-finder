'use client';

import PlaceDetailClient from '../../components/PlaceDetailClient';

export default function PlaygroundDetailPage({ params }) {
  const placeId = params?.id ? decodeURIComponent(String(params.id)) : '';
  return <PlaceDetailClient placeId={placeId} />;
}
