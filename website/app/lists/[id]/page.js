'use client';

import ListDetailClient from '../../components/ListDetailClient';

export default function ListDetailPage({ params }) {
  const listId = params?.id ? decodeURIComponent(String(params.id)) : '';
  return <ListDetailClient listId={listId} />;
}
