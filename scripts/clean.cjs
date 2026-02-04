#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');

if (fs.existsSync(releaseDir)) {
  console.log('🧹 清理 release 目录...');
  fs.rmSync(releaseDir, { recursive: true, force: true });
  console.log('✓ 清理完成');
} else {
  console.log('✓ release 目录不存在，无需清理');
}
