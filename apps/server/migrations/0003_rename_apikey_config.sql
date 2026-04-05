-- Rename API key configId from 'org-secret' to 'default' to match auth.ts config.
UPDATE apikey SET config_id = 'default' WHERE config_id = 'org-secret';
