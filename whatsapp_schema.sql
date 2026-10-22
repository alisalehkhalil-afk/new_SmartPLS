-- =====================================================================
-- WhatsApp Integration Database Schema for New_SmartPLS
-- Compatible with SQL Server 2012+ and WhatsAppSaaSSolution
-- =====================================================================

-- 1. WhatsApp Configuration & Notification Toggles Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tst_whatsapp_config')
BEGIN
    CREATE TABLE [dbo].[tst_whatsapp_config] (
        [config_id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [gateway_url] NVARCHAR(255) NOT NULL DEFAULT 'http://localhost:5050',
        [tenant_serial] NVARCHAR(100) NOT NULL DEFAULT 'SMARTPLS-TENANT-01',
        [api_token] NVARCHAR(MAX) NULL,
        [secret_key] NVARCHAR(255) NOT NULL DEFAULT 'SmartPLSSecretKey2026',
        [default_country_code] NVARCHAR(10) NOT NULL DEFAULT '967',
        [sender_phone] NVARCHAR(50) NULL,
        [notify_session_approved] BIT NOT NULL DEFAULT 1,
        [notify_report_ready] BIT NOT NULL DEFAULT 1,
        [notify_user_created] BIT NOT NULL DEFAULT 1,
        [is_enabled] BIT NOT NULL DEFAULT 1,
        [updated_at] DATETIME NOT NULL DEFAULT GETDATE(),
        [updated_by] NVARCHAR(50) NULL DEFAULT 'admin'
    );

    -- Seed default configuration row
    INSERT INTO [dbo].[tst_whatsapp_config] (
        [gateway_url], [tenant_serial], [secret_key], [default_country_code],
        [notify_session_approved], [notify_report_ready], [notify_user_created], [is_enabled]
    ) VALUES (
        'http://localhost:5050', 'SMARTPLS-TENANT-01', 'SmartPLSSecretKey2026', '967',
        1, 1, 1, 1
    );
END
GO

-- 2. WhatsApp Message Audit Logs Table
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tst_whatsapp_logs')
BEGIN
    CREATE TABLE [dbo].[tst_whatsapp_logs] (
        [log_id] INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
        [recipient_phone] NVARCHAR(50) NOT NULL,
        [recipient_name] NVARCHAR(150) NULL,
        [message_body] NVARCHAR(MAX) NOT NULL,
        [message_type] NVARCHAR(20) NOT NULL DEFAULT 'text', -- 'text', 'media', 'report'
        [status] NVARCHAR(20) NOT NULL DEFAULT 'SENT',       -- 'SENT', 'FAILED', 'QUEUED'
        [event_type] NVARCHAR(50) NOT NULL DEFAULT 'manual_test', -- 'session_approval', 'executive_report', 'user_credentials', 'manual_test'
        [gateway_response] NVARCHAR(MAX) NULL,
        [sent_by_user] NVARCHAR(50) NULL DEFAULT 'system',
        [created_at] DATETIME NOT NULL DEFAULT GETDATE()
    );

    IF NOT EXISTS (SELECT * FROM sys.indexes WHERE name = 'IX_tst_whatsapp_logs_created_at')
    BEGIN
        CREATE NONCLUSTERED INDEX [IX_tst_whatsapp_logs_created_at] 
        ON [dbo].[tst_whatsapp_logs] ([created_at] DESC);
    END
END
GO

-- 3. Legacy compatibility with am_settings_general (sms_menu)
IF EXISTS (SELECT * FROM sys.tables WHERE name = 'am_settings_general')
BEGIN
    -- Check if whatsapp_gateway_url row exists
    IF NOT EXISTS (SELECT 1 FROM am_settings_general WHERE SettingNameProgramitly = 'whatsapp_gateway_url')
    BEGIN
        INSERT INTO am_settings_general (
            SettingCode, SettingCode_name, SettingName, SettingNameProgramitly,
            SettingParentCode, SettingParentCode_name, setting_type_code, setting_type_code_line,
            setting_old_value, setting_new_value, row_level, setting_desc, setting_date,
            setting_status_code, setting_status_code_line, setting_category_code_id, setting_category_code_line,
            account_order, entry_user_id, entry_date_time, edit_date_time
        ) VALUES (
            'sms_menu', N'نظام الرسائل والواتساب', N'عنوان خادم بوابة الواتساب', 'whatsapp_gateway_url',
            'sms_menu', N'نظام الرسائل والواتساب', 'am_setting_type', 3,
            'http://localhost:5050', 'http://localhost:5050', 0, N'عنوان خادم بوابة الواتساب Enjazatik', GETDATE(),
            'ge_active_status', 0, 'am_setting_gatogory', 4,
            '0', '100', GETDATE(), GETDATE()
        );
    END
END
GO
