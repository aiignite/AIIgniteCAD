<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# AIIgniteCAD - AI-Powered CAD Editor

An intelligent CAD editor powered by AI, featuring real-time collaboration, DXF import/export, and multi-user project management.

## Run Locally

**Prerequisites:** Node.js 20+, Docker, Docker Compose

1. Clone the repository:
   ```bash
   git clone https://github.com/aiignite/AIIgniteCAD.git
   cd AIIgniteCAD
   ```

2. Install dependencies:
   ```bash
   # Frontend
   npm install

   # Backend
   cd backend
   npm install
   ```

3. Configure environment variables:
   ```bash
   # Copy .env.example to .env and configure
   cp .env.example .env
   ```

   Required environment variables:
   - `GEMINI_API_KEY`: Your Gemini API key
   - `JWT_SECRET`: Secret for JWT authentication
   - `DATABASE_URL`: PostgreSQL connection string

4. Start with Docker Compose:
   ```bash
   docker-compose up -d
   ```

5. Access the application:
   - Frontend: http://localhost:3400
   - Backend API: http://localhost:3410
   - PostgreSQL: localhost:5435

## Features

- **AI-Assisted Design**: Natural language interface for creating and editing CAD elements
- **Real-time Collaboration**: WebSocket-based multi-user editing
- **DXF Import/Export**: Full support for DXF file format
- **User Management**: JWT-based authentication and project management
- **Block System**: Reusable block definitions and references
- **Layer Management**: Organize elements into layers
- **Version History**: Track and revert changes

## Technology Stack

- **Frontend**: React, TypeScript, Vite, Tailwind CSS
- **Backend**: Express, TypeScript, Prisma ORM
- **Database**: PostgreSQL
- **AI Integration**: Google Gemini 2.0 Flash
- **Real-time**: Socket.IO
- **Containerization**: Docker, Docker Compose

## Project Structure

```
AIIgniteCAD/
├── components/          # React components
├── services/           # API and business logic
├── backend/            # Express backend
│   ├── prisma/        # Database schema
│   ├── src/
│   │   ├── routes/   # API endpoints
│   │   └── middleware/ # Auth and validation
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## Development

```bash
# Frontend development
npm run dev

# Backend development
cd backend
npm run dev

# Run Prisma migrations
cd backend
npx prisma migrate dev

# Generate Prisma client
npx prisma generate
```

## License

MIT License - see LICENSE file for details
