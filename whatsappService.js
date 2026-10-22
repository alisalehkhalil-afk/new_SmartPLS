/**
 * WhatsApp Gateway Service for New_SmartPLS
 * Integrates with WhatsAppSaaSSolution (Port 5050 - Enjazatik drop-in standard)
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const db = require('../config/db');

class WhatsAppService {
  constructor() {
    this.cachedConfig = null;
    this.lastConfigFetch = 0;
    this.cacheTTL = 30000; // 30 seconds
  }

  /**
   * Normalize and format phone number with country code
   */
  formatPhoneNumber(phone, countryCode = '967') {
    if (!phone) return '';
    let cleaned = String(phone).replace(/[\s\-\(\)\+]/g, '').trim();
    if (cleaned.startsWith('00')) {
      cleaned = cleaned.substring(2);
    }
    // If starts with leading 0 (e.g. 0770123456)
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }
    // If local 9-digit number (common in Yemen: 7XXXXXXXX)
    if (cleaned.length === 9) {
      cleaned = countryCode + cleaned;
    }
    return cleaned;
  }

  /**
   * Helper to perform HTTP/HTTPS JSON requests
   */
  async request(urlStr, options = {}, postData = null) {
    return new Promise((resolve, reject) => {
      try {
        const parsedUrl = new URL(urlStr);
        const isHttps = parsedUrl.protocol === 'https:';
        const client = isHttps ? https : http;

        const reqOptions = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (isHttps ? 443 : 80),
          path: parsedUrl.pathname + parsedUrl.search,
          method: options.method || 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            ...(options.headers || {})
          },
          timeout: options.timeout || 12000
        };

        if (postData && typeof postData === 'object') {
          postData = JSON.stringify(postData);
          reqOptions.headers['Content-Length'] = Buffer.byteLength(postData);
        }

        const req = client.request(reqOptions, (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            try {
              const parsed = body ? JSON.parse(body) : {};
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                data: parsed,
                rawBody: body
              });
            } catch (e) {
              resolve({
                statusCode: res.statusCode,
                headers: res.headers,
                data: { raw: body },
                rawBody: body
              });
            }
          });
        });

        req.on('timeout', () => {
          req.destroy(new Error('Connection timed out'));
        });

        req.on('error', (err) => {
          reject(err);
        });

        if (postData) {
          req.write(postData);
        }
        req.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Get WhatsApp configuration from database
   */
  async getConfig() {
    const now = Date.now();
    if (this.cachedConfig && (now - this.lastConfigFetch) < this.cacheTTL) {
      return this.cachedConfig;
    }

    try {
      const res = await db.query('SELECT TOP 1 * FROM tst_whatsapp_config ORDER BY config_id ASC');
      if (res.recordset && res.recordset.length > 0) {
        this.cachedConfig = res.recordset[0];
        this.lastConfigFetch = now;
        return this.cachedConfig;
      }
    } catch (err) {
      console.warn('[WhatsAppService] Warning fetching config from DB:', err.message);
    }

    // Default Fallback
    return {
      config_id: 1,
      gateway_url: 'http://localhost:5050',
      tenant_serial: 'SMARTPLS-TENANT-01',
      api_token: null,
      secret_key: 'SmartPLSSecretKey2026',
      default_country_code: '967',
      sender_phone: null,
      notify_session_approved: true,
      notify_report_ready: true,
      notify_user_created: true,
      is_enabled: true
    };
  }

  /**
   * Save and sync configuration
   */
  async saveConfig(configData, updatedBy = 'admin') {
    const existing = await this.getConfig();

    const {
      gateway_url = existing.gateway_url || 'http://localhost:5050',
      tenant_serial = existing.tenant_serial || 'SMARTPLS-TENANT-01',
      api_token = '',
      secret_key = '',
      default_country_code = existing.default_country_code || '967',
      sender_phone = existing.sender_phone || '',
      notify_session_approved = 1,
      notify_report_ready = 1,
      notify_user_created = 1,
      is_enabled = 1
    } = configData;

    // Preserve existing masked secrets if '********' is sent from frontend
    const finalApiToken = (api_token === '********' || !api_token) ? existing.api_token : api_token;
    const finalSecretKey = (secret_key === '********' || !secret_key) ? (existing.secret_key || 'SmartPLSSecretKey2026') : secret_key;

    try {
      await db.query(`
        IF EXISTS (SELECT 1 FROM tst_whatsapp_config)
        BEGIN
          UPDATE tst_whatsapp_config
          SET gateway_url = @gateway_url,
              tenant_serial = @tenant_serial,
              api_token = @api_token,
              secret_key = @secret_key,
              default_country_code = @default_country_code,
              sender_phone = @sender_phone,
              notify_session_approved = @notify_session_approved,
              notify_report_ready = @notify_report_ready,
              notify_user_created = @notify_user_created,
              is_enabled = @is_enabled,
              updated_at = GETDATE(),
              updated_by = @updatedBy
        END
        ELSE
        BEGIN
          INSERT INTO tst_whatsapp_config (
            gateway_url, tenant_serial, api_token, secret_key, default_country_code,
            sender_phone, notify_session_approved, notify_report_ready, notify_user_created,
            is_enabled, updated_by
          ) VALUES (
            @gateway_url, @tenant_serial, @api_token, @secret_key, @default_country_code,
            @sender_phone, @notify_session_approved, @notify_report_ready, @notify_user_created,
            @is_enabled, @updatedBy
          )
        END
      `, {
        gateway_url,
        tenant_serial,
        api_token: finalApiToken || null,
        secret_key: finalSecretKey,
        default_country_code,
        sender_phone: sender_phone || null,
        notify_session_approved: notify_session_approved ? 1 : 0,
        notify_report_ready: notify_report_ready ? 1 : 0,
        notify_user_created: notify_user_created ? 1 : 0,
        is_enabled: is_enabled ? 1 : 0,
        updatedBy
      });

      // Legacy synchronization with am_settings_general
      try {
        await db.query(`
          UPDATE am_settings_general
          SET setting_new_value = @gateway_url,
              edit_date_time = GETDATE(),
              edit_user_id = @updatedBy
          WHERE SettingNameProgramitly = 'whatsapp_gateway_url'
        `, { gateway_url, updatedBy });
      } catch (legacyErr) {
        console.warn('[WhatsAppService] Legacy sync warning:', legacyErr.message);
      }

      this.cachedConfig = null; // Invalidate cache
      return await this.getConfig();
    } catch (err) {
      console.error('[WhatsAppService] Error saving config:', err);
      throw err;
    }
  }

  /**
   * Build authentication token/header for WhatsApp Gateway
   */
  getAuthToken(config) {
    if (config.api_token && config.api_token.trim()) {
      return config.api_token.trim();
    }
    if (config.secret_key && config.secret_key.trim()) {
      return config.secret_key.trim();
    }
    return config.tenant_serial || 'SMARTPLS-TENANT-01';
  }

  /**
   * Check connection status with WhatsAppGateway.Api and Engine
   */
  async getStatus() {
    const config = await this.getConfig();
    const token = this.getAuthToken(config);
    const baseUrl = config.gateway_url.replace(/\/+$/, '');

    try {
      // 1. Check Gateway API device info
      const infoUrl = `${baseUrl}/api/device/info?token=${encodeURIComponent(token)}`;
      const res = await this.request(infoUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Tenant-Serial': config.tenant_serial
        },
        timeout: 6000
      });

      if (res.statusCode === 200 && res.data) {
        const deviceData = res.data.data || res.data;
        const isConnected = !!(deviceData && (deviceData.status === 'connected' || deviceData.sender));
        
        // Update sender_phone in config if detected
        if (deviceData.sender && deviceData.sender !== config.sender_phone) {
          try {
            await db.query(`
              UPDATE tst_whatsapp_config SET sender_phone = @sender WHERE config_id = @id
            `, { sender: deviceData.sender, id: config.config_id });
            config.sender_phone = deviceData.sender;
          } catch (e) {}
        }

        return {
          online: true,
          connected: isConnected,
          statusCode: res.statusCode,
          device: {
            name: deviceData.name || config.tenant_serial,
            serial: deviceData.serial || config.tenant_serial,
            sender: deviceData.sender || config.sender_phone || 'غير مقترن',
            quota: deviceData.quota !== undefined ? deviceData.quota : 'غير محدد',
            status: isConnected ? 'connected' : 'disconnected'
          },
          config: {
            gatewayUrl: config.gateway_url,
            tenantSerial: config.tenant_serial,
            isEnabled: !!config.is_enabled
          }
        };
      } else {
        return {
          online: true,
          connected: false,
          statusCode: res.statusCode,
          message: res.data?.message || 'الخدمة قيد التشغيل ولكن الجهاز غير متصل أو التوكن غير صالح',
          device: {
            status: 'disconnected',
            sender: config.sender_phone || null,
            quota: 0
          },
          config: {
            gatewayUrl: config.gateway_url,
            tenantSerial: config.tenant_serial,
            isEnabled: !!config.is_enabled
          }
        };
      }
    } catch (err) {
      return {
        online: false,
        connected: false,
        error: err.message,
        message: 'تعذر الاتصال بخادم الواتساب (تأكد من تشغيل WhatsAppGateway.Api على المنفذ 5050)',
        device: {
          status: 'offline',
          sender: null,
          quota: 0
        },
        config: {
          gatewayUrl: config.gateway_url,
          tenantSerial: config.tenant_serial,
          isEnabled: !!config.is_enabled
        }
      };
    }
  }

  /**
   * Retrieve live QR code from WhatsApp Gateway
   */
  async getQrCode() {
    const config = await this.getConfig();
    const token = this.getAuthToken(config);
    const baseUrl = config.gateway_url.replace(/\/+$/, '');
    const qrUrl = `${baseUrl}/api/device/qr-code?token=${encodeURIComponent(token)}`;

    try {
      const res = await this.request(qrUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Tenant-Serial': config.tenant_serial
        },
        timeout: 8000
      });

      if (res.statusCode === 200 && res.data) {
        return {
          success: res.data.status !== false,
          qr: res.data.qr || res.data.data?.qr || null,
          message: res.data.message || (res.data.qr ? 'تم استرجاع رمز الـ QR بنجاح' : 'الجهاز متصل بالفعل أو جاري إنشاء الرمز')
        };
      }
      return {
        success: false,
        message: res.data?.message || `فشل طلب رمز الـ QR (رمز الحالة: ${res.statusCode})`
      };
    } catch (err) {
      return {
        success: false,
        message: `خطأ اتصال: ${err.message}`
      };
    }
  }

  /**
   * Request 8-digit Pairing Code via phone number
   */
  async requestPairingCode(phoneNumber) {
    const config = await this.getConfig();
    const cleanPhone = this.formatPhoneNumber(phoneNumber, config.default_country_code);
    if (!cleanPhone) {
      return { success: false, message: 'رقم الهاتف مطلوب لتوليد كود الاقتران السريع' };
    }

    const token = this.getAuthToken(config);
    const baseUrl = config.gateway_url.replace(/\/+$/, '');
    const pairUrl = `${baseUrl}/api/device/pairing-code?token=${encodeURIComponent(token)}`;

    try {
      const res = await this.request(pairUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Tenant-Serial': config.tenant_serial
        },
        timeout: 10000
      }, {
        phoneNumber: cleanPhone
      });

      if (res.statusCode === 200 && res.data) {
        return {
          success: res.data.status !== false,
          code: res.data.code || res.data.pairingCode || res.data.data?.code,
          phone: cleanPhone,
          message: res.data.message || 'تم توليد كود الاقتران بنجاح. أدخل الكود في تطبيق الواتساب بجهازك.'
        };
      }

      return {
        success: false,
        message: res.data?.message || `تعذر توليد كود الاقتران (رمز الحالة: ${res.statusCode})`
      };
    } catch (err) {
      return {
        success: false,
        message: `خطأ اتصال: ${err.message}`
      };
    }
  }

  /**
   * Disconnect active WhatsApp session
   */
  async disconnectDevice() {
    const config = await this.getConfig();
    const token = this.getAuthToken(config);
    const baseUrl = config.gateway_url.replace(/\/+$/, '');
    const disUrl = `${baseUrl}/api/device/disconnect?token=${encodeURIComponent(token)}`;

    try {
      const res = await this.request(disUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Tenant-Serial': config.tenant_serial
        },
        timeout: 8000
      });

      return {
        success: res.statusCode === 200,
        message: res.data?.message || 'تم طلب فصل الجلسة بنجاح'
      };
    } catch (err) {
      return {
        success: false,
        message: `تعذر فصل الجلسة: ${err.message}`
      };
    }
  }

  /**
   * Send WhatsApp text message and record audit log
   */
  async sendMessage({ to, message, eventType = 'manual_test', recipientName = '', sentByUser = 'system' }) {
    const config = await this.getConfig();
    
    // Check if globally enabled
    if (!config.is_enabled) {
      console.log('[WhatsAppService] Service is disabled in configuration. Skipping send.');
      return { success: false, skipped: true, message: 'خدمة الواتساب معطلة حالياً في الإعدادات العامة' };
    }

    const cleanTo = this.formatPhoneNumber(to, config.default_country_code);
    if (!cleanTo || !message) {
      return { success: false, message: 'رقم المستلم ونص الرسالة حقول إجبارية' };
    }

    const token = this.getAuthToken(config);
    const baseUrl = config.gateway_url.replace(/\/+$/, '');
    const sendUrl = `${baseUrl}/api/v1/send-message?token=${encodeURIComponent(token)}`;

    let status = 'SENT';
    let gatewayResponseText = '';
    let success = false;

    try {
      const res = await this.request(sendUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Tenant-Serial': config.tenant_serial
        },
        timeout: 15000
      }, {
        number: cleanTo,
        message: message
      });

      gatewayResponseText = JSON.stringify(res.data || {});

      if (res.statusCode === 200 && res.data && res.data.status !== false) {
        success = true;
        status = 'SENT';
      } else {
        success = false;
        status = 'FAILED';
      }
    } catch (err) {
      success = false;
      status = 'FAILED';
      gatewayResponseText = JSON.stringify({ error: err.message });
    }

    // Persist into tst_whatsapp_logs
    try {
      await db.query(`
        INSERT INTO tst_whatsapp_logs (
          recipient_phone, recipient_name, message_body, message_type,
          status, event_type, gateway_response, sent_by_user, created_at
        ) VALUES (
          @recipient_phone, @recipient_name, @message_body, 'text',
          @status, @event_type, @gateway_response, @sent_by_user, GETDATE()
        )
      `, {
        recipient_phone: cleanTo,
        recipient_name: recipientName || null,
        message_body: message,
        status,
        event_type: eventType,
        gateway_response: gatewayResponseText,
        sent_by_user: sentByUser
      });
    } catch (logErr) {
      console.error('[WhatsAppService] Failed to insert audit log:', logErr.message);
    }

    return {
      success,
      status,
      recipient: cleanTo,
      message: success ? 'تم إرسال الرسالة بنجاح عبر بوابة الواتساب' : 'تعذر إرسال الرسالة',
      gatewayResponse: gatewayResponseText
    };
  }

  /**
   * Send WhatsApp Media/Document (PDF, Excel, Images) and record audit log
   */
  async sendMediaMessage({ to, filePath, fileName, caption = '', eventType = 'executive_report', recipientName = '', sentByUser = 'system' }) {
    const config = await this.getConfig();

    if (!config.is_enabled) {
      return { success: false, skipped: true, message: 'خدمة الواتساب معطلة حالياً في الإعدادات العامة' };
    }

    const cleanTo = this.formatPhoneNumber(to, config.default_country_code);
    if (!cleanTo || !filePath) {
      return { success: false, message: 'رقم المستلم ومسار الملف حقول إجبارية' };
    }

    const token = this.getAuthToken(config);
    const baseUrl = config.gateway_url.replace(/\/+$/, '');
    const sendMediaUrl = `${baseUrl}/api/v1/send-media?token=${encodeURIComponent(token)}`;

    let status = 'SENT';
    let gatewayResponseText = '';
    let success = false;

    const targetFile = path.resolve(filePath);
    const resolvedName = fileName || path.basename(targetFile);

    try {
      const res = await this.request(sendMediaUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-Tenant-Serial': config.tenant_serial
        },
        timeout: 45000
      }, {
        number: cleanTo,
        message: caption || '',
        urlfile: targetFile,
        filename: resolvedName
      });

      gatewayResponseText = JSON.stringify(res.data || {});

      if (res.statusCode === 200 && res.data && res.data.status !== false) {
        success = true;
        status = 'SENT';
      } else {
        success = false;
        status = 'FAILED';
      }
    } catch (err) {
      success = false;
      status = 'FAILED';
      gatewayResponseText = JSON.stringify({ error: err.message });
    }

    // Persist into tst_whatsapp_logs
    try {
      await db.query(`
        INSERT INTO tst_whatsapp_logs (
          recipient_phone, recipient_name, message_body, message_type,
          status, event_type, gateway_response, sent_by_user, created_at
        ) VALUES (
          @recipient_phone, @recipient_name, @message_body, 'document',
          @status, @event_type, @gateway_response, @sent_by_user, GETDATE()
        )
      `, {
        recipient_phone: cleanTo,
        recipient_name: recipientName || null,
        message_body: `[مستند: ${resolvedName}] ${caption}`.trim(),
        status,
        event_type: eventType,
        gateway_response: gatewayResponseText,
        sent_by_user: sentByUser
      });
    } catch (logErr) {
      console.error('[WhatsAppService] Failed to insert audit log for media:', logErr.message);
    }

    return {
      success,
      status,
      recipient: cleanTo,
      fileName: resolvedName,
      message: success ? `تم إرسال الملف [${resolvedName}] بنجاح عبر الواتساب` : `تعذر إرسال الملف [${resolvedName}]`,
      gatewayResponse: gatewayResponseText
    };
  }

  /**
   * Get audit logs
   */
  async getLogs(limit = 50) {
    try {
      const res = await db.query(`
        SELECT TOP (@limit)
          log_id, recipient_phone, recipient_name, message_body,
          message_type, status, event_type, gateway_response, sent_by_user, created_at
        FROM tst_whatsapp_logs
        ORDER BY log_id DESC
      `, { limit: parseInt(limit) || 50 });

      return res.recordset || [];
    } catch (err) {
      console.error('[WhatsAppService] Error fetching logs:', err);
      return [];
    }
  }
}

module.exports = new WhatsAppService();
