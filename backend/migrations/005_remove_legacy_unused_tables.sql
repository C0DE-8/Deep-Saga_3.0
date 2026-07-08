-- Migration: 005_remove_legacy_unused_tables.sql
-- Description: Removes legacy dungeon/player tables that are no longer used by the chat-based RPG flow.
-- Date: 2026-07-08

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS player_story_chapters;
DROP TABLE IF EXISTS player_story_events;
DROP TABLE IF EXISTS player_encounter_events;
DROP TABLE IF EXISTS player_encounter_enemies;
DROP TABLE IF EXISTS player_encounters;
DROP TABLE IF EXISTS player_enemy_evolution;
DROP TABLE IF EXISTS player_faction_reputation;
DROP TABLE IF EXISTS player_floor_states;
DROP TABLE IF EXISTS player_inventory;
DROP TABLE IF EXISTS player_memories;
DROP TABLE IF EXISTS player_skills;
DROP TABLE IF EXISTS player_condition_stats;
DROP TABLE IF EXISTS players;

DROP TABLE IF EXISTS floor_enemy_spawns;
DROP TABLE IF EXISTS enemy_loot_tables;
DROP TABLE IF EXISTS enemy_types;
DROP TABLE IF EXISTS dungeon_floors;
DROP TABLE IF EXISTS dungeon_levels;
DROP TABLE IF EXISTS dungeon_biome_hazards;

DROP TABLE IF EXISTS skills;

SET FOREIGN_KEY_CHECKS = 1;
