import fs from 'fs';
import https from 'https';
import path from 'path';

const modelsDir = './src/models';
const baseUrl = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js-models/master/';

const files = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1',
];

if (!fs.existsSync(modelsDir)) {
  fs.mkdirSync(modelsDir, { recursive: true });
}

files.forEach(file => {
  const filePath = path.join(modelsDir, file);
  const url = baseUrl + file;
  
  https.get(url, (res) => {
    const fileStream = fs.createWriteStream(filePath);
    res.pipe(fileStream);
    fileStream.on('finish', () => {
      fileStream.close();
      console.log(`Downloaded ${file}`);
    });
  }).on('error', (err) => {
    console.error(`Error downloading ${file}: ${err.message}`);
  });
});
