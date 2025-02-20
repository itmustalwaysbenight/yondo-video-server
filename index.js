require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3002;

// Configure CORS - more permissive during development
const corsOptions = {
  origin: [
    'https://yondo-video-analysis.vercel.app',
    'https://yondo-video-analysis-lake.vercel.app',
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'https://localhost:3000',
    'https://localhost:3001',
    'https://localhost:3002',
    process.env.FRONTEND_URL
  ].filter(Boolean),
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Accept']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));

// Add OPTIONS handler for preflight requests
app.options('*', cors(corsOptions));

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
fs.mkdir(tempDir, { recursive: true }).catch(console.error);

// Check if yt-dlp is installed
async function checkYtDlp() {
  try {
    await execAsync('yt-dlp --version');
    return true;
  } catch (error) {
    return false;
  }
}

app.post('/download', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Check if yt-dlp is installed
    const isYtDlpInstalled = await checkYtDlp();
    if (!isYtDlpInstalled) {
      return res.status(500).json({ 
        error: 'yt-dlp is not installed on the server',
        installInstructions: {
          mac: 'brew install yt-dlp',
          windows: 'choco install yt-dlp',
          linux: 'pip install yt-dlp'
        }
      });
    }

    // Create a unique filename
    const timestamp = Date.now();
    const tempFilePath = path.join(tempDir, `video-${timestamp}.mp4`);

    // Download video using yt-dlp
    const command = `yt-dlp -f "best[ext=mp4]" "${url}" -o "${tempFilePath}" --no-playlist --no-warnings`;
    const { stdout, stderr } = await execAsync(command);

    // Read the file and send it as base64
    const videoBuffer = await fs.readFile(tempFilePath);
    const base64Video = videoBuffer.toString('base64');

    // Clean up the temporary file
    await fs.unlink(tempFilePath);

    res.json({
      videoUrl: `data:video/mp4;base64,${base64Video}`,
      message: 'Video downloaded successfully'
    });

  } catch (error) {
    console.error('Error downloading video:', error);
    res.status(500).json({ 
      error: 'Failed to download video',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    cors: corsOptions
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`CORS origins: ${JSON.stringify(corsOptions.origin)}`);
}); 