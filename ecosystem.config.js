/**
 * PM2 Ecosystem — mantiene el servidor corriendo 24/7
 * Uso:
 *   npm install -g pm2
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 startup   ← arranca automáticamente con Windows
 */

module.exports = {
  apps: [
    {
      name: 'datos-psicologicos',
      script: './src/server.js',
      cwd: require('path').join(__dirname, 'backend'),
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
      },
      // Logs
      out_file: './logs/pm2-out.log',
      error_file: './logs/pm2-err.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
};
