# Venue Canonicalization Requirements

## Goals

- Show one top-level location per real-world venue or campus.
- Preserve distinct amenities, exhibits, fields, trails, and splash pads as subvenues under the parent.
- Prevent the same location from appearing as separate top-level rows across overlapping seeded regions.
- Run the same canonicalization logic after full seed, expansion, and light refresh.

## Canonicalization Model

- A top-level parent represents the visitable venue: park, zoo, museum, indoor play center, sports complex, or standalone attraction.
- A child subvenue represents a distinct on-site amenity or exhibit that should enrich the parent, not become a separate map/list card.
- A duplicate is a second listing for the same parent and should be archived without creating a meaningful subvenue row.
- A canonical parent can cover multiple `regionKey` values through `coveredRegionKeys`.

## Required Relationship Types

- `exact_duplicate`: same Google place id, near-identical coordinates, or same normalized address plus near-identical name.
- `address_subvenue`: same normalized address or address cluster, distinct child-style name/type.
- `campus_subvenue`: zoo, aquarium, museum, science center, amusement park, or large park parent with nearby visitor-facing children.
- `park_amenity`: public park parent with splash pad, playground, fields, courts, trail, pavilion, pool, or dog park children.
- `cross_region_duplicate`: same address/name cluster appearing under different `regionKey` values.

## Parent Selection

- Prefer umbrella names ending in `park`, `zoo`, `aquarium`, `museum`, `science center`, `sports complex`, `recreation area`, or `nature center`.
- Penalize child terms such as `splash pad`, `soccer field`, `field`, `court`, `trail`, `playground`, `exhibit`, `entrance`, `parking`, and `pavilion`.
- Prefer stronger data only after parent-likeness is established: photos, website, description, ratings, and verification count.

## Large Campus Requirements

- Large campus parents must support configurable radius by type.
- Zoo/aquarium/museum campuses default to a larger radius than same-address grouping.
- Henry Doorly-style exhibits must attach even when they do not share exact address or parent name tokens, as long as they are visitor-facing POIs within campus radius and not blocked food/retail/parking entries.

## Park Amenity Requirements

- Park parents can absorb nearby amenities with child-style names/types across the park property.
- Child amenities must remain visible in the parent `subVenues` array.
- Restaurants, stores, hotels, gas stations, schools, parking lots, and generic entrances are not auto-attached.

## Pipeline Requirements

- Full seed and background expansion must run canonicalization after scrub/enrichment.
- Light refresh must canonicalize newly inserted places and nearby existing places before completing.
- Archived child ids must continue blocking resurrection during future upserts.
- Preview/audit routes should expose why a child was attached.

## Testability Requirements

- Unit tests must cover zoo campuses with many exhibits across at least 1km.
- Unit tests must cover parks with splash pads, fields, trails, and playgrounds under one parent.
- Unit tests must cover same venue duplicated across regions.
- Unit tests must verify restaurants/parking near campuses are not auto-attached.
