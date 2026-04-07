const FileManager = require('../src/services/fileManager');
const path = require('path');

console.log('🧪 Running FileManager tests...\n');

const fm = new FileManager();

// Test getBaseFilename
console.log('📝 Testing getBaseFilename:');
const testCases = [
  // Canon _GP_ prefix
  ['_GP_0215.CR2', '_GP_0215'],
  ['_GP_0215_adj.tif', '_GP_0215'],
  ['_GP_0215_adj-Edit-2.tif', '_GP_0215'],
  ['_GP_0215_adj-Edit-Edit.psd', '_GP_0215'],
  
  // Canon _MG_ prefix
  ['_MG_9194.CR2', '_MG_9194'],
  ['_MG_9194-adj.tif', '_MG_9194'],
  
  // Generic IMG prefix
  ['IMG_1234.CR3', 'IMG_1234'],
  ['IMG_1234_HDR.jpg', 'IMG_1234'],
  
  // Sony DSC prefix
  ['DSC_0001.ARW', 'DSC_0001'],
  ['DSC_0001-Edit.psd', 'DSC_0001'],
];

let passedTests = 0;
let totalTests = 0;

testCases.forEach(([input, expected]) => {
  totalTests++;
  const result = fm.getBaseFilename(input);
  if (result === expected) {
    console.log(`✅ "${input}" → "${result}"`);
    passedTests++;
  } else {
    console.log(`❌ "${input}" → Expected "${expected}", got "${result}"`);
  }
});

console.log('\n📝 Testing isBaseImage:');
totalTests++;
if (fm.isBaseImage('test.CR2')) {
  console.log('✅ CR2 identified as base image');
  passedTests++;
} else {
  console.log('❌ CR2 not identified as base image');
}

totalTests++;
if (!fm.isBaseImage('test.tif')) {
  console.log('✅ TIF correctly not identified as base image');
  passedTests++;
} else {
  console.log('❌ TIF incorrectly identified as base image');
}

console.log(`\n📊 Results: ${passedTests}/${totalTests} tests passed`);
if (passedTests === totalTests) {
  console.log('🎉 All tests passed!');
} else {
  console.log('⚠️  Some tests failed');
  process.exit(1);
}
