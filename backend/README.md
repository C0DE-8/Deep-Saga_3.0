# Deep Saga 3.0 Backend

## Setup Instructions

### Prerequisites
- Node.js (v16 or higher)
- MySQL (v8.0 or higher)
- npm or yarn

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Database Setup
1. Start MySQL service
2. Create the database:
```sql
CREATE DATABASE deep_saga_3_0;
```
3. Run the migrations in order to create tables:
```bash
mysql -u root -p deep_saga_3_0 < migrations/001_initial_schema.sql
mysql -u root -p deep_saga_3_0 < migrations/002_monster_reincarnation_rpg.sql
mysql -u root -p deep_saga_3_0 < migrations/003_single_rpg_flow_and_10_floors.sql
```

### 3. Environment Configuration
Update the `.env` file with your database credentials:
```
DB_HOST=localhost
DB_USER=root
DB_PASS=your_mysql_password
DB_NAME=deep_saga_3_0
JWT_SECRET=your_secure_jwt_secret
GEMINI_API_KEY=your_gemini_api_key
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
```

### 4. Start the Server
For development:
```bash
npm run dev
```

For production:
```bash
npm start
```

The server will run on http://localhost:5000

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register a new user
- `POST /api/auth/login` - Login user

### Player
- `GET /api/player/profile` - Get player profile
- `GET /api/player/skills` - Get player skills and condition stats
- `POST /api/player/allocate-stats` - Allocate stat points
- `POST /api/player/persona` - Update player persona

### Monster Reincarnation RPG
- `GET /api/rpg/state` - Load the current reincarnation
- `POST /api/rpg/start` - Start or restart the reincarnation flow
- `POST /api/rpg/action` - Resolve a stat-driven RPG action

### Root
- `GET /` - Health check

## Database Schema

### Tables
- `users` - User accounts
- `players` - Player characters
- `player_condition_stats` - Player statistics for skill unlocking
- `skills` - Available skills
- `player_skills` - Player-skill relationships
- `rpg_reincarnations` - Monster RPG save state
- `rpg_action_log` - Consequence history for RPG actions
- `rpg_content_catalog` - Expandable RPG content definitions

## Development

The backend uses:
- Express.js for the web framework
- MySQL2 for database connections
- JWT for authentication
- Google Gemini AI for game features
