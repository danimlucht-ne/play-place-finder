'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import ListDetailClient from '../../components/ListDetailClient';

export default function ListDetailPage() {
  return (
    <Suspense fallback={<ListDetailClient listId="" />}>
      <ListDetailPageInner />
    </Suspense>
  );
}

function ListDetailPageInner() {
  const searchParams = useSearchParams();
  const listId = useMemo(() => searchParams.get('id') || '', [searchParams]);
  return <ListDetailClient listId={listId} />;
}
