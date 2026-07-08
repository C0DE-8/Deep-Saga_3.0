-- Migration: 002_monster_reincarnation_rpg.sql
-- Description: Adds independent difficulty saves and expandable text RPG character data.
-- Date: 2026-07-08

CREATE TABLE IF NOT EXISTS rpg_reincarnations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  difficulty ENUM('easy', 'medium', 'hard', 'god', 'impossible_god') NOT NULL DEFAULT 'medium',
  name VARCHAR(100) NOT NULL,
  species VARCHAR(100) NOT NULL,
  evolution_stage INT NOT NULL DEFAULT 0,
  level INT NOT NULL DEFAULT 1,
  xp INT NOT NULL DEFAULT 0,
  xp_to_next INT NOT NULL DEFAULT 100,
  hp INT NOT NULL DEFAULT 30,
  max_hp INT NOT NULL DEFAULT 30,
  mp INT NOT NULL DEFAULT 8,
  max_mp INT NOT NULL DEFAULT 8,
  stamina INT NOT NULL DEFAULT 20,
  max_stamina INT NOT NULL DEFAULT 20,
  hunger INT NOT NULL DEFAULT 80,
  soul_level INT NOT NULL DEFAULT 1,
  death_count INT NOT NULL DEFAULT 0,
  reincarnation_count INT NOT NULL DEFAULT 1,
  currency INT NOT NULL DEFAULT 0,
  reputation INT NOT NULL DEFAULT 0,
  area_key VARCHAR(100) NOT NULL DEFAULT 'moss_grotto',
  scene_title VARCHAR(160) NOT NULL DEFAULT 'First Breath',
  scene_text TEXT NOT NULL,
  stats_json JSON NOT NULL,
  derived_json JSON NOT NULL,
  skills_json JSON NOT NULL,
  passive_skills_json JSON NOT NULL,
  active_skills_json JSON NOT NULL,
  traits_json JSON NOT NULL,
  titles_json JSON NOT NULL,
  status_effects_json JSON NOT NULL,
  equipment_json JSON NOT NULL,
  inventory_json JSON NOT NULL,
  relationships_json JSON NOT NULL,
  achievements_json JSON NOT NULL,
  quests_json JSON NOT NULL,
  evolution_json JSON NOT NULL,
  world_flags_json JSON NOT NULL,
  is_alive BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_rpg_user_difficulty (user_id, difficulty)
);

CREATE TABLE IF NOT EXISTS rpg_action_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reincarnation_id INT NOT NULL,
  action_key VARCHAR(100) NOT NULL,
  summary TEXT NOT NULL,
  consequences_json JSON NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reincarnation_id) REFERENCES rpg_reincarnations(id) ON DELETE CASCADE,
  INDEX idx_rpg_action_log_reincarnation_id (reincarnation_id)
);

CREATE TABLE IF NOT EXISTS rpg_content_catalog (
  id INT AUTO_INCREMENT PRIMARY KEY,
  content_type ENUM('species', 'evolution', 'skill', 'quest', 'monster', 'boss', 'area', 'item') NOT NULL,
  content_key VARCHAR(120) NOT NULL,
  name VARCHAR(160) NOT NULL,
  data_json JSON NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY unique_rpg_content (content_type, content_key),
  INDEX idx_rpg_content_type (content_type)
);

INSERT INTO rpg_content_catalog (content_type, content_key, name, data_json)
VALUES
  ('area', 'moss_grotto', 'Moss Grotto', JSON_OBJECT('tier', 1, 'themes', JSON_ARRAY('survival', 'hunger', 'prey'))),
  ('area', 'moonfen', 'Moonfen', JSON_OBJECT('tier', 2, 'themes', JSON_ARRAY('tribes', 'mist', 'ambush'))),
  ('species', 'cave_slime', 'Cave Slime', JSON_OBJECT('stage', 0, 'role', 'adaptive survivor')),
  ('species', 'ash_imp', 'Ash Imp', JSON_OBJECT('stage', 0, 'role', 'fragile caster')),
  ('species', 'bone_rat', 'Bone Rat', JSON_OBJECT('stage', 0, 'role', 'fast scavenger')),
  ('monster', 'starving_beetle', 'Starving Beetle', JSON_OBJECT('level', 1, 'area', 'moss_grotto')),
  ('monster', 'fen_goblin', 'Fen Goblin', JSON_OBJECT('level', 4, 'area', 'moonfen')),
  ('boss', 'grotto_mother', 'Grotto Mother', JSON_OBJECT('level', 8, 'area', 'moss_grotto', 'locked_by', 'predator_seed')),
  ('quest', 'first_meal', 'First Meal', JSON_OBJECT('type', 'survival', 'target', 2)),
  ('quest', 'predator_seed', 'Seed of a Predator', JSON_OBJECT('type', 'combat', 'target', 3)),
  ('skill', 'survival_instinct', 'Survival Instinct', JSON_OBJECT('source', 'repeated training', 'rarity', 'common')),
  ('skill', 'scent_memory', 'Scent Memory', JSON_OBJECT('source', 'repeated exploration', 'rarity', 'uncommon')),
  ('item', 'monster_meat', 'Monster Meat', JSON_OBJECT('type', 'food', 'effect', 'restore hunger and health'))
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  data_json = VALUES(data_json),
  is_active = TRUE;
