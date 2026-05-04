module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'src/server.js',
      cwd: './backend',
      env: {
        NODE_ENV: 'development'
      },
      watch: ['src'],
      ignore_watch: ['node_modules', 'logs', 'dist']
    },
    {
      name: 'frontend',
      script: 'vite',
      cwd: './frontend',
      env: {
        NODE_ENV: 'development'
      }
    },
    {
      name: 'worker',
      script: 'src/queue/video-processor.js',
      cwd: './backend',
      env: {
        NODE_ENV: 'development'
      },
      watch: ['src/queue', 'src/services']
    }
  ]
};
