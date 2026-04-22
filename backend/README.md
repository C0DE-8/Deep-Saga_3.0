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
3. Run the migration to create tables:
```bash
mysql -u root -p deep_saga_3_0 < migrations/001_initial_schema.sql
```
Or run the full schema:
```bash
mysql -u root -p deep_saga_3_0 < deep_saga_3.0.sql
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

### Root
- `GET /` - Health check

## Database Schema

### Tables
- `users` - User accounts
- `players` - Player characters
- `player_condition_stats` - Player statistics for skill unlocking
- `skills` - Available skills
- `player_skills` - Player-skill relationships

## Development

The backend uses:
- Express.js for the web framework
- MySQL2 for database connections
- JWT for authentication
- Google Gemini AI for game features