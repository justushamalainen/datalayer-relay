const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Environment variables with defaults
const GA4_PROPERTY = process.env.GA4_PROPERTY || 'G-XXXXXXXXXX';
const SERVER_CONTAINER_URL = process.env.SERVER_CONTAINER_URL || 'https://localhost:8888';

// Template substitution function
function substituteTemplate(content) {
  return content
    .replace(/\{\{GA4_PROPERTY\}\}/g, GA4_PROPERTY)
    .replace(/\{\{SERVER_CONTAINER_URL\}\}/g, SERVER_CONTAINER_URL);
}

// Middleware to serve static files with template substitution for specific file types
app.use((req, res, next) => {
  // Try to serve from src/ first (for /src/* paths), then test-site/
  let filePath;

  if (req.path.startsWith('/src/')) {
    // Serve from src directory
    filePath = path.join(__dirname, req.path);
  } else {
    // Serve from test-site directory
    filePath = path.join(__dirname, 'test-site', req.path);
  }

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return next();
  }

  // Check if it's a directory
  if (fs.statSync(filePath).isDirectory()) {
    return next();
  }

  const ext = path.extname(filePath);

  // For JS and HTML files, apply template substitution
  if (['.js', '.html'].includes(ext)) {
    fs.readFile(filePath, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).send('Error reading file');
      }

      const processedContent = substituteTemplate(data);

      // Set appropriate content type
      const contentType = ext === '.js' ? 'application/javascript' : 'text/html';
      res.setHeader('Content-Type', contentType);
      res.send(processedContent);
    });
  } else {
    // For other files, serve as-is
    res.sendFile(filePath);
  }
});

// Serve index.html for root path
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'test-site', 'index.html');
  fs.readFile(indexPath, 'utf8', (err, data) => {
    if (err) {
      return res.status(500).send('Error reading index.html');
    }

    const processedContent = substituteTemplate(data);
    res.setHeader('Content-Type', 'text/html');
    res.send(processedContent);
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Template server running on http://localhost:${PORT}`);
  console.log(`📊 GA4 Property: ${GA4_PROPERTY}`);
  console.log(`🔗 Server Container URL: ${SERVER_CONTAINER_URL}`);
  console.log('\n✅ All files in test-site/ will be served with environment variable substitution\n');
});
