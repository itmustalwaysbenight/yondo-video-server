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

console.log('Starting server initialization...');
console.log('Environment:', process.env.NODE_ENV);
console.log('Port:', PORT);
console.log('Using PORT from environment:', process.env.PORT);

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
console.log('Creating temp directory...');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir);
}

// Check yt-dlp installation
async function checkYtDlp() {
  console.log('Checking yt-dlp installation...');
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
        console.log('yt-dlp is already installed');
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
  let outputPath = null;

  try {
    // First verify the URL is accessible
    const verifyCommand = `yt-dlp --no-download --get-title "${url}"`;
    console.log('Verifying URL with command:', verifyCommand);
    
    const title = await new Promise((resolve, reject) => {
      exec(verifyCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('Error verifying video:', error);
          console.error('stderr:', stderr);
          reject(new Error('Invalid or inaccessible video URL'));
          return;
        }
        resolve(stdout.trim());
      });
    });

    // Generate a unique filename
    const filename = crypto.randomBytes(16).toString('hex') + '.mp4';
    outputPath = path.join(tempDir, filename);

    console.log('Output path:', outputPath);
    console.log('Video title:', title);

    // Download video using yt-dlp with progress
    const command = `yt-dlp -f "bestvideo[ext=mp4][filesize<50M]+bestaudio[ext=m4a]/mp4" "${url}" -o "${outputPath}" --max-filesize 50M`;
    console.log('Download command:', command);
    
    await new Promise((resolve, reject) => {
      const download = exec(command);
      
      download.stdout.on('data', (data) => {
        console.log('stdout:', data);
      });

      download.stderr.on('data', (data) => {
        console.log('stderr:', data);
      });

      download.on('error', (err) => {
        console.error('Download process error:', err);
        reject(err);
      });

      download.on('exit', (code) => {
        if (code !== 0) {
          console.error(`Download process exited with code ${code}`);
          reject(new Error(`Process exited with code ${code}`));
          return;
        }
        resolve();
      });
    });

    // Verify the file exists and get its size
    if (!fs.existsSync(outputPath)) {
      throw new Error('Video file not found after download');
    }

    const stat = fs.statSync(outputPath);
    console.log('Video file size:', stat.size);

    // Stream the file
    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });

    const readStream = fs.createReadStream(outputPath);
    
    readStream.on('error', (err) => {
      console.error('Error streaming file:', err);
      if (!res.headersSent) {
        res.status(500).json({
          status: 'error',
          error: 'Error streaming video file'
        });
      }
    });

    readStream.pipe(res);

    // Clean up the file after streaming
    readStream.on('end', () => {
      fs.unlink(outputPath, (err) => {
        if (err) console.error('Error deleting temp file:', err);
        else console.log('Temp file deleted successfully');
      });
    });

  } catch (error) {
    console.error('Server error:', error);
    // Clean up the output file if it exists
    if (outputPath && fs.existsSync(outputPath)) {
      try {
        fs.unlinkSync(outputPath);
        console.log('Cleaned up temp file after error');
      } catch (cleanupError) {
        console.error('Error cleaning up temp file:', cleanupError);
      }
    }
    
    if (!res.headersSent) {
      res.status(500).json({ 
        status: 'error',
        error: 'Server error',
        details: error.message 
      });
    }
  }
});

console.log('Server initialization complete - ready to handle requests');

// Start server with error handling
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Environment:', process.env.NODE_ENV);
  console.log('CORS origins:', JSON.stringify(corsOptions.origin));
}).on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Please try a different port.`);
    process.exit(1);
  } else {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM signal. Shutting down gracefully...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});