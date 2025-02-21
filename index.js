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
    // Get yt-dlp location
    const { stdout: location } = await execAsync('which yt-dlp');
    const ytdlpPath = location.trim();
    console.log('yt-dlp location:', ytdlpPath);

    // Verify we can execute it
    await execAsync(`${ytdlpPath} --version`);
    console.log('yt-dlp is executable');

    // Get version info
    const { stdout: version } = await execAsync(`${ytdlpPath} --version`);
    console.log('yt-dlp version:', version.trim());

    // Test basic functionality
    await execAsync(`${ytdlpPath} --help`);
    console.log('yt-dlp help command works');

    return true;
  } catch (error) {
    console.error('yt-dlp check failed:', error);
    console.error('Current PATH:', process.env.PATH);
    console.error('Current directory:', process.cwd());
    return false;
  }
}

app.post('/download', async (req, res) => {
  // Add CORS debug logging
  console.log('[Download] Request received:', {
    origin: req.headers.origin,
    url: req.body?.url,
    timestamp: new Date().toISOString()
  });
  
  if (!isServerReady) {
    // Check yt-dlp status
    const ytDlpStatus = await checkYtDlp();
    const serverState = {
      ready: false,
      ytDlpInstalled: ytDlpStatus,
      message: 'Server is still initializing',
      details: `Server state: ${ytDlpStatus ? 'yt-dlp installed' : 'yt-dlp not installed'}`
    };
    console.log('[Download] Server not ready:', serverState);
    return res.status(503).json(serverState);
  }
  
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Handle version check request
    if (url === 'version') {
      try {
        // Get both location and version
        const [location, version] = await Promise.all([
          execAsync('which yt-dlp').then(r => r.stdout.trim()),
          execAsync('yt-dlp --version').then(r => r.stdout.trim())
        ]);

        // Test if we can execute yt-dlp
        await execAsync(`${location} --help`);
        
        return res.json({ 
          version,
          location,
          status: 'ok',
          executable: true
        });
      } catch (error) {
        console.error('[Download] Version check failed:', error);
        return res.status(500).json({
          error: 'Failed to verify yt-dlp',
          details: error.message,
          path: process.env.PATH,
          pwd: process.cwd()
        });
      }
    }

    console.log('[Download] Starting video download for URL:', url);
    
    // First verify yt-dlp is working
    try {
      const { stdout: version } = await execAsync('yt-dlp --version');
      console.log('[Download] yt-dlp version check passed:', version.trim());
    } catch (error) {
      console.error('[Download] yt-dlp version check failed:', error);
      return res.status(500).json({
        error: 'yt-dlp is not working properly',
        details: error.message
      });
    }
    
    // Create a unique filename
    const timestamp = Date.now();
    const tempFilePath = path.join(tempDir, `video-${timestamp}.mp4`);
    console.log('[Download] Temp file path:', tempFilePath);

    // Download video using yt-dlp with more verbose output
    const command = `yt-dlp -f "best[ext=mp4]" "${url}" -o "${tempFilePath}" --no-playlist`;
    console.log('[Download] Executing command:', command);
    
    try {
      const { stdout, stderr } = await execAsync(command);
      console.log('[Download] yt-dlp stdout:', stdout);
      if (stderr) console.error('[Download] yt-dlp stderr:', stderr);
    } catch (dlError) {
      console.error('[Download] yt-dlp execution failed:', dlError);
      return res.status(500).json({
        error: 'Video download failed',
        details: dlError.message,
        command: command
      });
    }

    // Verify the file exists and has content
    try {
      const stats = await fs.stat(tempFilePath);
      console.log('[Download] File stats:', stats);
      
      if (stats.size === 0) {
        throw new Error('Downloaded file is empty');
      }
    } catch (statError) {
      console.error('[Download] File verification failed:', statError);
      return res.status(500).json({
        error: 'Failed to verify downloaded file',
        details: statError.message
      });
    }

    // Read the file and send it as base64
    try {
      const videoBuffer = await fs.readFile(tempFilePath);
      const base64Video = videoBuffer.toString('base64');
      console.log('[Download] Successfully converted video to base64');

      // Clean up the temporary file
      await fs.unlink(tempFilePath).catch(e => console.error('[Download] Cleanup error:', e));

      return res.json({
        videoUrl: `data:video/mp4;base64,${base64Video}`,
        message: 'Video downloaded successfully'
      });
    } catch (readError) {
      console.error('[Download] Failed to read or encode video:', readError);
      return res.status(500).json({
        error: 'Failed to process downloaded video',
        details: readError.message
      });
    }

  } catch (error) {
    console.error('[Download] Unhandled error:', error);
    res.status(500).json({ 
      error: 'Failed to download video',
      details: error.message,
      type: error.constructor.name
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

// Add yt-dlp debug endpoint
app.get('/debug/ytdlp', async (req, res) => {
  console.log('[Debug] yt-dlp debug request received');
  try {
    const debugInfo = {
      status: {
        installed: false,
        executable: false,
        version: null,
        location: null,
        helpWorks: false
      },
      environment: {
        PATH: process.env.PATH,
        PWD: process.cwd(),
        uid: process.getuid?.(),
        gid: process.getgid?.(),
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version
      },
      tests: []
    };

    try {
      // Test 1: Find yt-dlp
      console.log('[Debug] Testing yt-dlp location...');
      const { stdout: location } = await execAsync('which yt-dlp');
      debugInfo.status.location = location.trim();
      debugInfo.status.installed = true;
      debugInfo.tests.push({ name: 'find_ytdlp', status: 'success', output: location.trim() });
      console.log('[Debug] Found yt-dlp at:', location.trim());
    } catch (e) {
      console.error('[Debug] Failed to find yt-dlp:', e);
      debugInfo.tests.push({ 
        name: 'find_ytdlp', 
        status: 'error', 
        error: e.message,
        PATH: process.env.PATH
      });
    }

    if (debugInfo.status.installed) {
      try {
        // Test 2: Check version
        console.log('[Debug] Testing yt-dlp version...');
        const { stdout: version } = await execAsync(`${debugInfo.status.location} --version`);
        debugInfo.status.version = version.trim();
        debugInfo.status.executable = true;
        debugInfo.tests.push({ name: 'version_check', status: 'success', output: version.trim() });
        console.log('[Debug] yt-dlp version:', version.trim());
      } catch (e) {
        console.error('[Debug] Failed to get yt-dlp version:', e);
        debugInfo.tests.push({ 
          name: 'version_check', 
          status: 'error', 
          error: e.message,
          command: `${debugInfo.status.location} --version`
        });
      }

      try {
        // Test 3: Check help
        console.log('[Debug] Testing yt-dlp help...');
        const { stdout: help } = await execAsync(`${debugInfo.status.location} --help`);
        debugInfo.status.helpWorks = true;
        debugInfo.tests.push({ 
          name: 'help_check', 
          status: 'success', 
          output: help.slice(0, 100) + '...',
          fullHelp: help  // Include full help text for debugging
        });
        console.log('[Debug] yt-dlp help command works');
      } catch (e) {
        console.error('[Debug] Failed to get yt-dlp help:', e);
        debugInfo.tests.push({ 
          name: 'help_check', 
          status: 'error', 
          error: e.message,
          command: `${debugInfo.status.location} --help`
        });
      }

      // Additional test: Try a simple URL info fetch
      try {
        console.log('[Debug] Testing yt-dlp URL info fetch...');
        const { stdout: info } = await execAsync(`${debugInfo.status.location} --dump-json "https://www.youtube.com/watch?v=dQw4w9WgXcQ" --no-download`);
        debugInfo.tests.push({ 
          name: 'url_info_check', 
          status: 'success', 
          output: 'URL info fetch successful'
        });
        console.log('[Debug] yt-dlp URL info fetch works');
      } catch (e) {
        console.error('[Debug] Failed to fetch URL info:', e);
        debugInfo.tests.push({ 
          name: 'url_info_check', 
          status: 'error', 
          error: e.message
        });
      }
    }

    console.log('[Debug] Sending debug info response');
    res.json(debugInfo);
  } catch (error) {
    console.error('[Debug] Failed to collect debug info:', error);
    res.status(500).json({
      error: 'yt-dlp debug info collection failed',
      details: error.message,
      stack: error.stack,
      type: error.constructor.name
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