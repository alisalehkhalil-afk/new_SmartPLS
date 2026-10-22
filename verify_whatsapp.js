/**
 * Automated Verification Script for WhatsApp Integration
 * Runs comprehensive end-to-end tests for database, service layer,
 * REST API routes, event triggers, and UI endpoints.
 */

const http = require('http');
const db = require('./config/db');
const whatsappService = require('./services/whatsappService');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`[PASS] ${testName}`);
    passedTests++;
  } else {
    console.error(`[FAIL] ${testName}`);
    failedTests++;
  }
}

function httpReq(options, postData = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: data ? JSON.parse(data) : {}, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, data: { raw: data }, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

(async () => {
  console.log('================================================================');
  console.log('Starting Verification Suite: WhatsApp Integration in New_SmartPLS');
  console.log('================================================================');

  try {
    // -----------------------------------------------------------------
    // 1. Database Schema & Tables Verification
    // -----------------------------------------------------------------
    console.log('\n--- 1. Testing Database Schema & Persistence ---');
    const configRes = await db.query('SELECT TOP 1 * FROM tst_whatsapp_config');
    assert(configRes.recordset && configRes.recordset.length > 0, 'tst_whatsapp_config table exists and has active record');
    
    const cfg = configRes.recordset[0];
    assert(cfg.gateway_url && cfg.gateway_url.includes('5050'), 'Gateway URL is configured (default 5050)');
    assert(cfg.tenant_serial === 'SMARTPLS-TENANT-01', 'Tenant Serial is initialized');
    assert(cfg.notify_session_approved === true, 'Notification toggle: session_approved is BIT 1');
    assert(cfg.notify_report_ready === true, 'Notification toggle: report_ready is BIT 1');
    assert(cfg.notify_user_created === true, 'Notification toggle: user_created is BIT 1');

    const logsRes = await db.query('SELECT COUNT(*) AS total FROM tst_whatsapp_logs');
    assert(logsRes.recordset && logsRes.recordset[0]?.total !== undefined, 'tst_whatsapp_logs audit table exists and is accessible');

    const legacyRes = await db.query("SELECT * FROM am_settings_general WHERE SettingNameProgramitly = 'whatsapp_gateway_url'");
    assert(legacyRes.recordset && legacyRes.recordset.length > 0, 'am_settings_general legacy setting row is present and synchronized');

    // -----------------------------------------------------------------
    // 2. Service Layer & Phone Normalization Tests
    // -----------------------------------------------------------------
    console.log('\n--- 2. Testing Service Layer & Phone Normalization ---');
    assert(whatsappService.formatPhoneNumber('771234567', '967') === '967771234567', 'Normalizes 9-digit local phone with default country code');
    assert(whatsappService.formatPhoneNumber('0771234567', '967') === '967771234567', 'Strips leading zero and prefixes country code');
    assert(whatsappService.formatPhoneNumber('+967 77-123-4567', '967') === '967771234567', 'Strips plus, spaces, and hyphens correctly');
    assert(whatsappService.formatPhoneNumber('00967771234567', '967') === '967771234567', 'Strips international 00 prefix');

    const activeCfg = await whatsappService.getConfig();
    assert(activeCfg && activeCfg.gateway_url, 'whatsappService.getConfig() returns active configuration');

    // Test saving config
    const updatedCfg = await whatsappService.saveConfig({
      gateway_url: 'http://localhost:5050',
      tenant_serial: 'SMARTPLS-TENANT-01',
      default_country_code: '967',
      secret_key: 'SmartPLSSecretKey2026',
      notify_session_approved: 1,
      notify_report_ready: 1,
      notify_user_created: 1,
      is_enabled: 1
    }, 'test_runner');
    assert(updatedCfg.tenant_serial === 'SMARTPLS-TENANT-01', 'whatsappService.saveConfig() successfully updates and persists config');

    // -----------------------------------------------------------------
    // 3. Message Audit Logging Verification
    // -----------------------------------------------------------------
    console.log('\n--- 3. Testing Audit Logging & Fallback Handling ---');
    const sendResult = await whatsappService.sendMessage({
      to: '771234567',
      message: 'اختبار فحص تكامل النظام الآلي لخدمة الواتساب',
      eventType: 'manual_test',
      recipientName: 'المقيم التجريبي',
      sentByUser: 'verifier'
    });
    assert(sendResult.recipient === '967771234567', 'Phone formatted before dispatch attempt');
    assert(sendResult.status === 'SENT' || sendResult.status === 'FAILED', 'Message status recorded correctly');

    const recentLogs = await whatsappService.getLogs(5);
    assert(recentLogs.length > 0, 'Audit log persisted in database table tst_whatsapp_logs');
    const latestLog = recentLogs[0];
    assert(latestLog.recipient_phone === '967771234567', 'Audit log records exact normalized recipient');
    assert(latestLog.event_type === 'manual_test', 'Audit log records event_type accurately');
    assert(latestLog.sent_by_user === 'verifier', 'Audit log records sent_by_user');

    // -----------------------------------------------------------------
    // 4. REST API Endpoints Verification (Port 3000)
    // -----------------------------------------------------------------
    console.log('\n--- 4. Testing REST API Endpoints ---');
    
    // GET /api/whatsapp/config
    const getCfgRes = await httpReq({
      hostname: 'localhost', port: 3000, path: '/api/whatsapp/config', method: 'GET'
    });
    assert(getCfgRes.status === 200 && getCfgRes.data.success, 'GET /api/whatsapp/config returns HTTP 200');
    assert(getCfgRes.data.config.gatewayUrl.includes('5050'), 'GET /api/whatsapp/config returns gatewayUrl');

    // POST /api/whatsapp/config
    const postCfgRes = await httpReq({
      hostname: 'localhost', port: 3000, path: '/api/whatsapp/config', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      gatewayUrl: 'http://localhost:5050',
      tenantSerial: 'SMARTPLS-TENANT-01',
      defaultCountryCode: '967',
      secretKey: 'SmartPLSSecretKey2026',
      notifySessionApproved: true,
      notifyReportReady: true,
      notifyUserCreated: true,
      isEnabled: true
    });
    assert(postCfgRes.status === 200 && postCfgRes.data.success, 'POST /api/whatsapp/config updates configuration via API');

    // GET /api/whatsapp/status
    const getStatusRes = await httpReq({
      hostname: 'localhost', port: 3000, path: '/api/whatsapp/status', method: 'GET'
    });
    assert(getStatusRes.status === 200 && getStatusRes.data.success, 'GET /api/whatsapp/status returns HTTP 200 with health state');
    assert(getStatusRes.data.status && typeof getStatusRes.data.status.online === 'boolean', 'Status payload has online boolean flag');

    // GET /api/whatsapp/qr
    const getQrRes = await httpReq({
      hostname: 'localhost', port: 3000, path: '/api/whatsapp/qr', method: 'GET'
    });
    assert(getQrRes.status === 200, 'GET /api/whatsapp/qr responds cleanly (HTTP 200)');

    // POST /api/whatsapp/send-test
    const sendTestRes = await httpReq({
      hostname: 'localhost', port: 3000, path: '/api/whatsapp/send-test', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      phone: '777000111',
      message: 'رسالة فحص من موجه الـ API',
      recipientName: 'المستشار التقني'
    });
    assert(sendTestRes.status === 200, 'POST /api/whatsapp/send-test processes message request cleanly');

    // GET /api/whatsapp/logs
    const getLogsRes = await httpReq({
      hostname: 'localhost', port: 3000, path: '/api/whatsapp/logs?limit=10', method: 'GET'
    });
    assert(getLogsRes.status === 200 && Array.isArray(getLogsRes.data.logs), 'GET /api/whatsapp/logs returns array of audit logs');
    assert(getLogsRes.data.logs.length > 0, 'Logs array contains recorded entries');

    // POST /api/whatsapp/send-report
    const sendReportRes = await httpReq({
      hostname: 'localhost', port: 3000, path: '/api/whatsapp/send-report', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      surveyId: 101,
      recipientPhone: '779998877',
      recipientName: 'مدير عام النظام المالي',
      customNote: 'تم تدقيق كافة المحاور بنجاح'
    });
    assert(sendReportRes.status === 200, 'POST /api/whatsapp/send-report computes compliance and dispatches summary');

    // -----------------------------------------------------------------
    // 5. Automated System Event Triggers Verification
    // -----------------------------------------------------------------
    console.log('\n--- 5. Testing Automated Triggers (Users & Sessions) ---');
    
    // User creation trigger
    const testUserId = 'test_wa_' + Date.now().toString().slice(-4);
    const createUserRes = await httpReq({
      hostname: 'localhost', port: 3000, path: '/api/users', method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, {
      userId: testUserId,
      userName: 'مستخدم تجريبي للواتساب',
      password: 'password123',
      mobile: '778899000',
      role: 'tech'
    });
    assert(createUserRes.status === 200 && createUserRes.data.success, 'POST /api/users creates user and triggers WhatsApp credentials alert');

    // Wait 500ms for async event to persist in logs
    await new Promise(r => setTimeout(r, 600));
    const userCredLog = await db.query(`
      SELECT TOP 1 * FROM tst_whatsapp_logs 
      WHERE event_type = 'user_credentials' AND recipient_phone = '967778899000'
      ORDER BY log_id DESC
    `);
    assert(userCredLog.recordset && userCredLog.recordset.length > 0, 'User creation event persisted into WhatsApp audit log with credentials');

    // Session approval trigger
    const sessionRes = await httpReq({
      hostname: 'localhost', port: 3000, path: '/api/sessions/1/approve', method: 'PUT',
      headers: { 'Content-Type': 'application/json' }
    }, { approvedBy: '100', notifyPhone: '771234567' });
    assert(sessionRes.status === 200 && sessionRes.data.success, 'PUT /api/sessions/:id/approve executes and triggers WhatsApp session alert');

    await new Promise(r => setTimeout(r, 600));
    const sessionLog = await db.query(`
      SELECT TOP 1 * FROM tst_whatsapp_logs 
      WHERE event_type = 'session_approval'
      ORDER BY log_id DESC
    `);
    assert(sessionLog.recordset && sessionLog.recordset.length > 0, 'Session approval event persisted into WhatsApp audit log');

    // Cleanup test user
    await db.query(`DELETE FROM am_user_detail_group WHERE user_id = @id; DELETE FROM am_user WHERE user_id = @id;`, { id: testUserId });

    // -----------------------------------------------------------------
    // 6. Frontend Pages & Routing Verification
    // -----------------------------------------------------------------
    console.log('\n--- 6. Testing Frontend Pages & UI Routing ---');
    const pageRes = await httpReq({
      hostname: 'localhost', port: 3000, path: '/whatsapp_settings.html', method: 'GET'
    });
    assert(pageRes.status === 200, 'GET /whatsapp_settings.html returns HTTP 200');
    assert(pageRes.raw.includes('WhatsApp Gateway Hub'), 'Page content contains WhatsApp Gateway Hub title');
    assert(pageRes.raw.includes('pairingCodeDisplay'), 'Page content contains live Pairing Code container');
    assert(pageRes.raw.includes('qrContainer'), 'Page content contains live QR Code container');

    const cleanRouteRes = await httpReq({
      hostname: 'localhost', port: 3000, path: '/whatsapp-settings', method: 'GET'
    });
    assert(cleanRouteRes.status === 200, 'GET /whatsapp-settings clean URL route returns HTTP 200');

    // -----------------------------------------------------------------
    // Final Summary
    // -----------------------------------------------------------------
    console.log('\n================================================================');
    console.log(`WhatsApp Verification Complete: ${passedTests} Passed, ${failedTests} Failed`);
    console.log('================================================================');

    if (failedTests === 0) {
      console.log('ALL WHATSAPP INTEGRATION TESTS PASSED 100%!');
      process.exit(0);
    } else {
      console.error(`FAILED: ${failedTests} tests failed.`);
      process.exit(1);
    }

  } catch (err) {
    console.error('Fatal verification error:', err);
    process.exit(1);
  }
})();
