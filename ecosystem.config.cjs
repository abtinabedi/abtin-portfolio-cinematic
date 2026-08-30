// pm2 process definition.
//   pm2 start ecosystem.config.cjs
//   pm2 reload abtin-portfolio     (zero-downtime redeploy)
//   pm2 logs abtin-portfolio
//
// Change `cwd` to wherever you upload the site on the server.
module.exports = {
  apps: [
    {
      name: "abtin-portfolio",
      script: "./server.mjs",
      cwd: "/var/www/abtin-portfolio",

      // Static file serving is I/O bound and trivial; one fork is plenty.
      instances: 1,
      exec_mode: "fork",

      env: {
        NODE_ENV: "production",
        PORT: 4173,
        // Bind to loopback when nginx sits in front. Use 0.0.0.0 to expose directly.
        HOST: "127.0.0.1",
      },

      autorestart: true,
      watch: false,
      max_memory_restart: "150M",
      kill_timeout: 5000,

      out_file: "./logs/out.log",
      error_file: "./logs/err.log",
      merge_logs: true,
      time: true,
    },
  ],
};
