require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Initialize express app
const app = express();
const PORT = process.env.PORT || 3002;

// Configure CORS
const corsOptions = {
  origin: [
    'https://yondo-video-analysis.vercel.app',
    'https://yondo-video-analysis-lake.vercel.app',
    process.env.FRONTEND_URL,
    ...(process.env.NODE_ENV === 'development' 
      ? [
          'http://localhost:3000',
          'http://localhost:3001',
          'http://localhost:3002',
          'https://localhost:3000',
          'https://localhost:3001',
          'https://localhost:3002'
        ] 
      : []
    )
  ].filter(Boolean),
  methods: ['GET', 'POST', 'OPTIONS'],
  credentials: true,
  allowedHeaders: ['Content-Type', 'Accept']
};

// Apply middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(morgan('dev'));

// Create temp directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Check yt-dlp installation
async function checkYtDlp() {
  return new Promise((resolve, reject) => {
    exec('which yt-dlp', (error, stdout, stderr) => {
      if (error) {
        console.error('yt-dlp not found:', error);
        reject(error);
        return;
      }
      const ytDlpPath = stdout.trim();
      console.log('yt-dlp location:', ytDlpPath);
      
      // Check if executable
      exec('yt-dlp --version', (error, stdout, stderr) => {
        if (error) {
          console.error('yt-dlp not executable:', error);
          reject(error);
          return;
        }
        console.log('yt-dlp version:', stdout.trim());
        resolve(true);
      });
    });
  });
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'ok',
    message: 'Yondo Video Server is running',
    endpoints: {
      health: '/health',
      download: '/download'
    }
  });
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    const ytDlpInstalled = await checkYtDlp();
    res.json({ 
      status: 'ok', 
      ready: true,
      version: '1.0.0',
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        platform: process.platform,
        arch: process.arch
      },
      cors: corsOptions,
      ytdlp: {
        installed: ytDlpInstalled,
        version: '2025.02.19'
      },
      tempDir: {
        path: tempDir,
        exists: fs.existsSync(tempDir)
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      ready: false,
      error: error.message
    });
  }
});

// Download endpoint
app.post('/download', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ 
      status: 'error',
      error: 'URL is required' 
    });
  }

  console.log('Received download request for URL:', url);

  try {
    // First verify the URL is accessible
    const verifyCommand = `yt-dlp --no-download --get-title "${url}"`;
    const title = await new Promise((resolve, reject) => {
      exec(verifyCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('Error verifying video:', error);
          reject(new Error('Invalid or inaccessible video URL'));
          return;
        }
        resolve(stdout.trim());
      });
    });

    // Generate a unique filename
    const filename = crypto.randomBytes(16).toString('hex') + '.mp4';
    const outputPath = path.join(tempDir, filename);

    console.log('Output path:', outputPath);
    console.log('Video title:', title);

    // Download video using yt-dlp with progress
    const command = `yt-dlp -f "bestvideo[ext=mp4][filesize<50M]+bestaudio[ext=m4a]/mp4" "${url}" -o "${outputPath}" --max-filesize 50M`;
    
    const download = exec(command);
    let error = null;
    let progress = 0;

    download.stderr.on('data', (data) => {
      console.log('Download progress:', data);
      // Extract progress percentage if available
      const match = data.toString().match(/(\d+\.?\d*)%/);
      if (match) {
        progress = parseFloat(match[1]);
      }
    });

    download.on('error', (err) => {
      error = err;
      console.error('Download error:', err);
      if (!res.headersSent) {
        res.status(500).json({ 
          status: 'error',
          error: 'Download failed',
          details: err.message 
        });
      }
    });

    download.on('exit', (code) => {
      if (code !== 0) {
        if (!res.headersSent) {
          res.status(500).json({ 
            status: 'error',
            error: 'Download failed',
            details: `Process exited with code ${code}` 
          });
        }
        return;
      }

      if (!fs.existsSync(outputPath)) {
        if (!res.headersSent) {
          res.status(500).json({ 
            status: 'error',
            error: 'Video file not found after download' 
          });
        }
        return;
      }

      // Stream the file to the client
      const stat = fs.statSync(outputPath);
      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Content-Length': stat.size,
        'Content-Disposition': `attachment; filename="${filename}"`,
      });

      const readStream = fs.createReadStream(outputPath);
      readStream.pipe(res);

      readStream.on('end', () => {
        // Clean up the file after streaming
        fs.unlink(outputPath, (err) => {
          if (err) console.error('Error deleting temp file:', err);
        });
      });
    });

  } catch (error) {
    console.error('Server error:', error);
    if (!res.headersSent) {
      res.status(500).json({ 
        status: 'error',
        error: 'Server error',
        details: error.message 
      });
    }
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV);
  console.log('CORS origins:', JSON.stringify(corsOptions.origin));
});