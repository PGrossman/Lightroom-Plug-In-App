const axios = require('axios');
const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying setup...\n');

// Check protected folders exist
const protectedFolders = [
  'z_Logs and traces',
  'z_VERSIONS',
  'zz_Lightroom Meta Data Docs - DO NOT TOUCH',
  'zzz_CLAUDE'
];

protectedFolders.forEach(folder => {
  if (fs.existsSync(folder)) {
    console.log(`✓ Protected folder exists: ${folder}`);
  } else {
    console.log(`⚠ Protected folder missing: ${folder}`);
  }
});

// Check Node version
console.log(`\n✓ Node.js version: ${process.version}`);

// Check if Ollama is running
axios.get('http://localhost:11434/api/tags')
  .then(() => console.log('✓ Ollama is running'))
  .catch(() => console.log('✗ Ollama not available (run: ollama serve)'));

// Check src structure
const srcDirs = ['src/main', 'src/renderer', 'src/services', 'src/utils'];
console.log('\n📁 Checking directory structure:');
srcDirs.forEach(dir => {
  if (fs.existsSync(dir)) {
    console.log(`✓ ${dir}`);
  } else {
    console.log(`⚠ Missing: ${dir}`);
  }
});

console.log('\n✅ Setup verification complete!');

