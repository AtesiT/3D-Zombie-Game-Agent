import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

/**
 * Custom middleware plugin so `/assets/...` requests serve directly from `./assets/...`
 * in both dev and preview modes without duplicating binary files.
 */
function serveRepoAssetsPlugin() {
  return {
    name: 'serve-repo-assets',
    configureServer(server) {
      server.middlewares.use('/assets', (req, res, next) => {
        const cleanUrl = (req.url || '').split('?')[0];
        const filePath = path.join(process.cwd(), 'assets', cleanUrl);
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
          const ext = path.extname(filePath).toLowerCase();
          const mimeTypes = {
            '.json': 'application/json; charset=utf-8',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.svg': 'image/svg+xml',
            '.wav': 'audio/wav',
            '.mp3': 'audio/mpeg'
          };
          res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
          fs.createReadStream(filePath).pipe(res);
          return;
        }
        next();
      });
    }
  };
}

export default defineConfig({
  publicDir: 'public',
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    cors: true
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true
  },
  plugins: [serveRepoAssetsPlugin()]
});
