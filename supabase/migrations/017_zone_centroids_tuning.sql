-- 017_zone_centroids_tuning.sql
-- Tune zone centroids to real Sharm el-Sheikh geography.
--
-- The mig 005 centroids placed Soho (34.3270, 27.9170) almost on top of Naama
-- (34.3300, 27.9100) — ~400m apart — so resolve_zone_nearest() (nearest-centroid)
-- was ambiguous for pins near Naama (a Naama pin resolved to 'soho' in testing).
--
-- These coordinates are corrected to the actual neighborhoods (lng, lat order),
-- well-separated so nearest-centroid resolves correctly until precise `boundary`
-- polygons are added (resolution already prefers ST_Contains when boundary is set).
--
-- Reference anchors (real): Sharm centre 34.3299/27.9158; Naama Bay 34.3267/27.9133;
-- Ras Um El Sid (Hadaba) 34.3104/27.8482. North→south along the coast:
-- Nabq (far north, by airport) → Sharks Bay → Soho/White Knight → Naama Bay →
-- Hadaba/Old Market (south headland) → inland residential (El Salam, Mubarak 7,
-- Rowaisat, Hay El Nour).

-- Tourist coastal strip (north → south)
update public.zones set centroid = st_setsrid(st_makepoint(34.4250, 27.9750), 4326)::geography where id = 'nabq';        -- far north, near airport
update public.zones set centroid = st_setsrid(st_makepoint(34.3560, 27.9200), 4326)::geography where id = 'sharks_bay';  -- north of Naama
update public.zones set centroid = st_setsrid(st_makepoint(34.3470, 27.9270), 4326)::geography where id = 'soho';        -- Soho/White Knight, NE of Naama (was overlapping Naama)
update public.zones set centroid = st_setsrid(st_makepoint(34.3267, 27.9133), 4326)::geography where id = 'naama';       -- Naama Bay (real coords)

-- Southern headland / old town
update public.zones set centroid = st_setsrid(st_makepoint(34.3050, 27.8560), 4326)::geography where id = 'hadaba';      -- Hadaba / Ras Um El Sid plateau
update public.zones set centroid = st_setsrid(st_makepoint(34.2920, 27.8520), 4326)::geography where id = 'old_market';  -- Old Market (south)

-- Inland residential belt (west of the coast, spread so they don't collide)
update public.zones set centroid = st_setsrid(st_makepoint(34.3180, 27.8880), 4326)::geography where id = 'el_salam';
update public.zones set centroid = st_setsrid(st_makepoint(34.3120, 27.8700), 4326)::geography where id = 'mubarak_7';
update public.zones set centroid = st_setsrid(st_makepoint(34.3260, 27.8950), 4326)::geography where id = 'el_rowaisat';
update public.zones set centroid = st_setsrid(st_makepoint(34.3050, 27.8820), 4326)::geography where id = 'hay_el_nour';
update public.zones set centroid = st_setsrid(st_makepoint(34.2980, 27.8640), 4326)::geography where id = 'el_hadaba_residential';
