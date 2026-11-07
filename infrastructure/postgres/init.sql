CREATE TABLE IF NOT EXISTS sensor_measurements (
  id BIGSERIAL PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL,
  niveau_percent NUMERIC(5,2),
  distance_cm NUMERIC(8,2),
  hauteur_cm NUMERIC(8,2),
  puissance_pompe_percent NUMERIC(5,2),
  debit_cm_s NUMERIC(8,2),
  servo_angle_deg INTEGER,
  vanne_ouverture_deg INTEGER,
  measured_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fill_time_estimated_s NUMERIC(10,2),
  volume_liters NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS alerts (
  id BIGSERIAL PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL,
  alert_type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL,
  level_percent NUMERIC(5,2),
  distance_cm NUMERIC(8,2),
  message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS device_states (
  id BIGSERIAL PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL,
  pompe_state VARCHAR(20),
  relais_state VARCHAR(20),
  fuite_state VARCHAR(20),
  system_state VARCHAR(50),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS commands (
  id BIGSERIAL PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL,
  command_type VARCHAR(50) NOT NULL,
  command_value VARCHAR(50),
  topic VARCHAR(150),
  source VARCHAR(50) DEFAULT 'node-red',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  command_id VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS command_acks (
  id BIGSERIAL PRIMARY KEY,
  command_id VARCHAR(100) NOT NULL,
  device_id VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL,
  message TEXT,
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_measurements_device_time ON sensor_measurements (device_id, measured_at DESC);
CREATE INDEX IF NOT EXISTS idx_states_device_time ON device_states (device_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_device_time ON alerts (device_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commands_command_id ON commands (command_id);
CREATE INDEX IF NOT EXISTS idx_acks_command_id ON command_acks (command_id);
