-- Migration: 001_initial_schema.sql
-- Description: Initial database schema for Deep Saga 3.0
-- Date: 2024-12-19

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  email VARCHAR(100) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  role ENUM('player', 'admin') DEFAULT 'player',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Players table
CREATE TABLE IF NOT EXISTS players (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  persona ENUM('ADMIN', 'TRICKSTER', 'SENSEI') DEFAULT 'ADMIN',
  name VARCHAR(100) NOT NULL,
  current_race VARCHAR(50) DEFAULT 'Lost Soul',
  current_title VARCHAR(50) DEFAULT 'Unawakened',
  level INT DEFAULT 0,
  exp INT DEFAULT 0,
  stat_points INT DEFAULT 8,
  hp INT DEFAULT 40,
  max_hp INT DEFAULT 40,
  strength_stat INT DEFAULT 4,
  dexterity_stat INT DEFAULT 4,
  stamina_stat INT DEFAULT 4,
  intelligence_stat INT DEFAULT 4,
  charisma_stat INT DEFAULT 4,
  wisdom_stat INT DEFAULT 4,
  current_floor INT DEFAULT 1,
  current_area VARCHAR(100) DEFAULT 'Unknown Chamber',
  life_number INT DEFAULT 1,
  is_alive BOOLEAN DEFAULT TRUE,
  year_survived INT DEFAULT 1,
  day_survived INT DEFAULT 1,
  current_hour INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Player condition stats table
CREATE TABLE IF NOT EXISTS player_condition_stats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  player_id INT NOT NULL,
  stat_key VARCHAR(100) NOT NULL,
  stat_value INT DEFAULT 0,
  metadata_json JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  UNIQUE KEY unique_player_stat (player_id, stat_key)
);

-- Skills table
CREATE TABLE IF NOT EXISTS skills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  skill_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  skill_type ENUM('passive', 'active') DEFAULT 'passive',
  unlock_type ENUM('level', 'condition') DEFAULT 'level',
  required_level INT,
  condition_stat_key VARCHAR(100),
  condition_threshold INT,
  effect_json JSON,
  is_dynamic BOOLEAN DEFAULT FALSE,
  source_pattern VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Player skills table
CREATE TABLE IF NOT EXISTS player_skills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  player_id INT NOT NULL,
  skill_id INT NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  unlocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
  UNIQUE KEY unique_player_skill (player_id, skill_id)
);

-- Indexes for better performance
CREATE INDEX idx_players_user_id ON players(user_id);
CREATE INDEX idx_player_condition_stats_player_id ON player_condition_stats(player_id);
CREATE INDEX idx_player_condition_stats_stat_key ON player_condition_stats(stat_key);
CREATE INDEX idx_player_skills_player_id ON player_skills(player_id);
CREATE INDEX idx_skills_skill_key ON skills(skill_key);