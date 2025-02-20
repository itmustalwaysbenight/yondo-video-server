# Video Download Server

This is a Node.js server that handles video downloads using yt-dlp. It's designed to work with the Yondo Video Analysis frontend.

## Prerequisites

- Node.js 18+
- Python 3
- yt-dlp

## Local Development

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file:
```bash
PORT=3001
```

3. Start the development server:
```bash
npm run dev
```

## Deployment

### Using Docker

1. Build the Docker image:
```bash
docker build -t video-download-server .
```

2. Run the container:
```bash
docker run -p 3001:3001 video-download-server
```

### Deployment Options

1. **DigitalOcean App Platform**:
   - Fork this repository
   - Create a new app in DigitalOcean
   - Select the repository
   - Choose Docker as the deployment method
   - Set environment variables if needed

2. **Railway**:
   - Connect your GitHub repository
   - Create a new project
   - Select Docker deployment
   - The Dockerfile will handle the rest

3. **Heroku**:
   ```bash
   heroku container:push web
   heroku container:release web
   ```

## Environment Variables

- `PORT`: Server port (default: 3001)
- `NODE_ENV`: Environment mode ('development' or 'production')

## API Endpoints

### POST /download
Downloads a video from the provided URL.

Request body:
```json
{
  "url": "https://www.tiktok.com/..."
}
```

Response:
```json
{
  "videoUrl": "data:video/mp4;base64,...",
  "message": "Video downloaded successfully"
}
```

### GET /health
Health check endpoint.

Response:
```json
{
  "status": "ok"
}
``` 