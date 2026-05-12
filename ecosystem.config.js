module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'backend/src/server.js',
      env: {
        NODE_ENV: 'development'
      },
      watch: ['backend/src'],
      ignore_watch: ['node_modules', 'logs', 'dist']
    },
    {
      name: 'worker',
      script: 'backend/src/queue/video-processor.js',
      env: {
        NODE_ENV: 'development'
      },
      watch: ['backend/src/queue', 'backend/src/services']
    }
  ]
};
