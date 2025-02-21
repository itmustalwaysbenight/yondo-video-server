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

// Add startup state tracking
let isServerReady = false;

// Initialize server
async function initializeServer() {
  try {
    console.log('Starting server initialization...');
    
    // Ensure temp directory exists
    console.log('Creating temp directory...');
    await fs.mkdir(tempDir, { recursive: true });
    
    // Check yt-dlp installation
    console.log('Checking yt-dlp installation...');
    const isYtDlpInstalled = await checkYtDlp();
    
    if (!isYtDlpInstalled) {
      console.log('yt-dlp not installed, attempting installation...');
      try {
        // Try pip install first
        await execAsync('pip install --user yt-dlp');
      } catch (pipError) {
        console.log('pip install failed, trying curl installation...');
        try {
          // If pip fails, try direct download
          await execAsync('curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp');
          await execAsync('chmod a+rx /usr/local/bin/yt-dlp');
        } catch (curlError) {
          console.error('Failed to install yt-dlp via curl:', curlError);
          throw new Error('Failed to install yt-dlp after multiple attempts');
        }
      }
      
      // Verify installation
      const verifyInstall = await checkYtDlp();
      if (!verifyInstall) {
        throw new Error('yt-dlp installation verification failed');
      }
      console.log('yt-dlp installed successfully');
    } else {
      console.log('yt-dlp is already installed');
    }
    
    isServerReady = true;
    console.log('Server initialization complete - ready to handle requests');
  } catch (error) {
    console.error('Server initialization failed:', error);
    throw error;
  }
}

// Improve yt-dlp check
async function checkYtDlp() {
  try {
    const { stdout } = await execAsync('which yt-dlp');
    console.log('yt-dlp location:', stdout.trim());
    const { stdout: version } = await execAsync('yt-dlp --version');
    console.log('yt-dlp version:', version.trim());
    return true;
  } catch (error) {
    console.error('yt-dlp check failed:', error);
    return false;
  }
}

app.post('/download', async (req, res) => {
  // Add CORS debug logging
  console.log('Received request from origin:', req.headers.origin);
  console.log('Request headers:', req.headers);
  
  if (!isServerReady) {
    // Check yt-dlp status
    const ytDlpStatus = await checkYtDlp();
    const serverState = {
      ready: false,
      ytDlpInstalled: ytDlpStatus,
      message: 'Server is still initializing',
      details: `Server state: ${ytDlpStatus ? 'yt-dlp installed' : 'yt-dlp not installed'}`
    };
    console.log('Server not ready:', serverState);
    return res.status(503).json(serverState);
  }
  
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    console.log('Starting video download for URL:', url);
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
app.get('/health', async (req, res) => {
  // Check yt-dlp status
  const ytDlpStatus = await checkYtDlp();
  
  // Get environment info
  let envInfo = {
    NODE_ENV: process.env.NODE_ENV || 'development',
    PATH: process.env.PATH,
    PWD: process.env.PWD,
    platform: process.platform,
    arch: process.arch
  };

  res.json({ 
    status: isServerReady ? 'ready' : 'initializing',
    version: process.env.npm_package_version || '1.0.0',
    environment: envInfo,
    cors: corsOptions,
    ready: isServerReady,
    ytdlp: {
      installed: ytDlpStatus,
      path: ytDlpStatus ? (await execAsync('which yt-dlp')).stdout.trim() : null,
      version: ytDlpStatus ? (await execAsync('yt-dlp --version')).stdout.trim() : null
    },
    tempDir: {
      path: tempDir,
      exists: await fs.access(tempDir).then(() => true).catch(() => false)
    }
  });
});

// Debug endpoint
app.get('/debug', async (req, res) => {
  try {
    const debugInfo = {
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        PWD: process.env.PWD,
        platform: process.platform,
        arch: process.arch
      },
      directories: {
        current: process.cwd(),
        temp: tempDir,
        home: process.env.HOME
      },
      commands: {
        ls: (await execAsync('ls -la')).stdout,
        pwd: (await execAsync('pwd')).stdout,
        which_python: await execAsync('which python3').then(r => r.stdout).catch(e => e.message),
        which_pip: await execAsync('which pip3').then(r => r.stdout).catch(e => e.message),
        which_ytdlp: await execAsync('which yt-dlp').then(r => r.stdout).catch(e => e.message)
      }
    };
    
    res.json(debugInfo);
  } catch (error) {
    res.status(500).json({
      error: 'Debug info collection failed',
      details: error.message,
      stack: error.stack
    });
  }
});

// Initialize server before starting
initializeServer()
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV}`);
      console.log(`CORS origins: ${JSON.stringify(corsOptions.origin)}`);
    });
  })
  .catch(error => {
    console.error('Failed to initialize server:', error);
    process.exit(1);
  }); 