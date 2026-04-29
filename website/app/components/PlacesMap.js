'use client';

import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

function FixDefaultIcon() {
  useEffect(() => {
    delete L.Icon.Default.prototype._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
      iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    });
  }, []);
  return null;
}

function FitBounds({ points, selectedId }) {
  const map = useMap();
  useEffect(() => {
    if (!points.length) return;
    const selected = selectedId
      ? points.find((x) => String(x.id) === String(selectedId))
      : null;
    if (selected) {
      map.flyTo([selected.lat, selected.lng], Math.max(map.getZoom(), 15), { duration: 0.4 });
      return;
    }
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13);
    } else {
      const b = L.latLngBounds(points.map((p) => [p.lat, p.lng]));
      map.fitBounds(b, { padding: [40, 40], maxZoom: 15 });
    }
  }, [map, points, selectedId]);
  return null;
}

function SelectableMarker({ point, isSelected, onSelect }) {
  const markerRef = useRef(/** @type {L.Marker | null} */ (null));
  useEffect(() => {
    const m = markerRef.current;
    if (isSelected && m) {
      m.openPopup();
    }
  }, [isSelected, point.id]);

  return (
    <Marker
      ref={markerRef}
      position={[point.lat, point.lng]}
      eventHandlers={{ click: () => onSelect?.(String(point.id)) }}
    >
      <Popup>
        <strong>{point.name || 'Place'}</strong>
        <br />
        <a href={`/playground/${encodeURIComponent(point.id)}/`}>Details</a>
      </Popup>
    </Marker>
  );
}

/**
 * @param {{
 *   places: Array<Record<string, unknown>>,
 *   height?: number,
 *   selectedId?: string,
 *   onMarkerClick?: (id: string) => void
 * }} props
 */
export default function PlacesMap({ places, height = 420, selectedId = '', onMarkerClick = null }) {
  const points = useMemo(
    () =>
      (places || [])
        .map((p) => ({
          id: p._id,
          lat: Number(p.latitude),
          lng: Number(p.longitude),
          name: p.name,
        }))
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)),
    [places],
  );

  if (points.length === 0) {
    return <p className="hub-muted-copy">No mappable coordinates in the current result set.</p>;
  }

  const first = points[0];

  return (
    <div
      className="hub-map-wrap"
      style={{
        height,
        borderRadius: 12,
        overflow: 'hidden',
        border: '1px solid rgba(0,0,0,0.1)',
      }}
    >
      <MapContainer
        center={[first.lat, first.lng]}
        zoom={12}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom
      >
        <FixDefaultIcon />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={points} selectedId={selectedId} />
        {points.map((p) => (
          <SelectableMarker
            key={String(p.id)}
            point={p}
            isSelected={Boolean(selectedId) && String(selectedId) === String(p.id)}
            onSelect={onMarkerClick}
          />
        ))}
      </MapContainer>
    </div>
  );
}
