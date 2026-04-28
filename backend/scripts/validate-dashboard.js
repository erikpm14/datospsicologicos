#!/usr/bin/env node

/**
 * validate-dashboard.js
 *
 * Valida que los endpoints de observabilidad funcionan correctamente.
 */

const http = require('http');

const endpoints = [
  { path: '/api/dashboard/video-status', name: 'video-status' },
  { path: '/api/dashboard/next-slot', name: 'next-slot' },
  { path: '/api/dashboard/health', name: 'health' },
];

async function testEndpoint(path, name) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'localhost',
      port: 3001,
      path,
      method: 'GET',
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({
            name,
            path,
            status: res.statusCode,
            ok: res.statusCode === 200 && json,
            hasData: Object.keys(json).length > 0,
            responseSize: data.length,
            error: null,
          });
        } catch (err) {
          resolve({
            name,
            path,
            status: res.statusCode,
            ok: false,
            hasData: false,
            responseSize: data.length,
            error: `Parse error: ${err.message}`,
          });
        }
      });
    });

    req.on('error', (err) => {
      resolve({
        name,
        path,
        status: null,
        ok: false,
        hasData: false,
        responseSize: 0,
        error: err.message,
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        name,
        path,
        status: null,
        ok: false,
        hasData: false,
        responseSize: 0,
        error: 'Timeout (15s)',
      });
    });

    req.setTimeout(15000); // Aumentar a 15s
    req.end();
  });
}

async function validate() {
  console.log('\n╔════════════════════════════════════════════════════════╗');
  console.log('║  DASHBOARD OBSERVABILITY VALIDATION                  ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('Testing endpoints...\n');

  const results = await Promise.all(endpoints.map((e) => testEndpoint(e.path, e.name)));

  let allOk = true;
  results.forEach((result) => {
    const statusIcon = result.ok ? '✅' : '❌';
    console.log(`${statusIcon} ${result.name.padEnd(20)} | HTTP ${result.status || 'N/A'} | ${result.responseSize} bytes`);

    if (result.error) {
      console.log(`   Error: ${result.error}`);
      allOk = false;
    }

    if (!result.hasData) {
      console.log(`   Warning: No data in response`);
    }
  });

  console.log('\n════════════════════════════════════════════════════════\n');

  const summary = {
    allEndpointsOk: results.every((r) => r.ok),
    endpointsWorking: results.filter((r) => r.ok).length,
    endpointsTotal: results.length,
    errors: results.filter((r) => r.error).map((r) => `${r.name}: ${r.error}`),
  };

  console.log(`Endpoints working: ${summary.endpointsWorking}/${summary.endpointsTotal}`);

  if (summary.allEndpointsOk) {
    console.log('\n✅ DASHBOARD ENDPOINTS VALIDATION PASSED\n');
    process.exit(0);
  } else {
    console.log('\n❌ SOME ENDPOINTS FAILED:\n');
    summary.errors.forEach((err) => console.log(`  - ${err}`));
    console.log();
    process.exit(1);
  }
}

validate();
