-- Migration: 003_single_rpg_flow_and_10_floors.sql
-- Description: Simplifies RPG progression to one save flow and adds 10-floor descent tracking.
-- Date: 2026-07-08

ALTER TABLE rpg_reincarnations
  ADD COLUMN current_floor INT NOT NULL DEFAULT 1 AFTER area_key;

UPDATE rpg_reincarnations
SET current_floor = COALESCE(
  CAST(JSON_UNQUOTE(JSON_EXTRACT(world_flags_json, '$.current_floor')) AS UNSIGNED),
  1
)
WHERE current_floor IS NULL OR current_floor < 1;

UPDATE rpg_reincarnations
SET current_floor = 10
WHERE current_floor > 10;

INSERT INTO rpg_content_catalog (content_type, content_key, name, data_json)
VALUES
  ('area', 'floor_1_moss_grotto', 'Floor 1: Moss Grotto', JSON_OBJECT('floor', 1, 'theme', 'newborn survival')),
  ('area', 'floor_2_fungal_sump', 'Floor 2: Fungal Sump', JSON_OBJECT('floor', 2, 'theme', 'poison and spores')),
  ('area', 'floor_3_bone_runoff', 'Floor 3: Bone Runoff', JSON_OBJECT('floor', 3, 'theme', 'scavengers')),
  ('area', 'floor_4_moonfen', 'Floor 4: Moonfen', JSON_OBJECT('floor', 4, 'theme', 'tribal hunters')),
  ('area', 'floor_5_ruined_warren', 'Floor 5: Ruined Warren', JSON_OBJECT('floor', 5, 'theme', 'ambush corridors')),
  ('area', 'floor_6_ember_hollow', 'Floor 6: Ember Hollow', JSON_OBJECT('floor', 6, 'theme', 'heat and ash')),
  ('area', 'floor_7_silver_mire', 'Floor 7: Silver Mire', JSON_OBJECT('floor', 7, 'theme', 'illusions')),
  ('area', 'floor_8_obsidian_roots', 'Floor 8: Obsidian Roots', JSON_OBJECT('floor', 8, 'theme', 'ancient growth')),
  ('area', 'floor_9_crownless_den', 'Floor 9: Crownless Den', JSON_OBJECT('floor', 9, 'theme', 'apex predators')),
  ('area', 'floor_10_monarch_pit', 'Floor 10: Monarch Pit', JSON_OBJECT('floor', 10, 'theme', 'first ruler trial')),
  ('boss', 'floor_10_monarch', 'The Uncrowned Monarch', JSON_OBJECT('floor', 10, 'level', 12, 'locked_by', 'reach_floor_10'))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  data_json = VALUES(data_json),
  is_active = TRUE;
