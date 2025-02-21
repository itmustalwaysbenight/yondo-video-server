const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function checkEnvironment() {
  const checks = {
    node: false,
    python: false,
    ytdlp: false,
    temp: false
  };

  try {
    // Check Node.js
    const nodeVersion = process.version;
    console.log('Node.js version:', nodeVersion);
    checks.node = true;

    // Check Python
    const pythonVersion = execSync('python3 --version').toString();
    console.log('Python version:', pythonVersion.trim());
    checks.python = true;

    // Check yt-dlp
    const ytdlpVersion = execSync('yt-dlp --version').toString();
    console.log('yt-dlp version:', ytdlpVersion.trim());
    checks.ytdlp = true;

    // Check temp directory
    const tempDir = path.join(__dirname, 'temp');
    fs.accessSync(tempDir, fs.constants.W_OK);
    console.log('Temp directory is writable:', tempDir);
    checks.temp = true;

    return {
      status: 'healthy',
      checks
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      checks,
      error: error.message
    };
  }
}

const result = checkEnvironment();
console.log('Health check result:', result);

if (result.status !== 'healthy') {
  process.exit(1);
}

process.exit(0); 